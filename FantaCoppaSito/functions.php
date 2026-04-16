<?php
require_once 'db.php';

// Includi PHPMailer
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception;

require 'PHPMailer/Exception.php';
require 'PHPMailer/PHPMailer.php';
require 'PHPMailer/SMTP.php';

function startSession() {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}

/**
 * Registra un nuovo utente.
 * @return int|false ID utente creato, oppure false in caso di errore
 */
function registerUser($username, $email, $password) {
    startSession();
    $conn = getDbConnection();
    $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
    
    $stmt = $conn->prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)");
    $stmt->bind_param("sss", $username, $email, $hashedPassword);
    
    try {
        $stmt->execute();
        $userId = (int) $conn->insert_id;
        $stmt->close();
        if ($userId <= 0) {
            error_log("Registration error: insert_id non valido");
            return false;
        }
        // Budget iniziale
        $budgetStmt = $conn->prepare("INSERT INTO user_budget (user_id, budget) VALUES (?, 100)");
        $budgetStmt->bind_param("i", $userId);
        $budgetStmt->execute();
        $budgetStmt->close();
        return $userId;
    } catch (Exception $e) {
        error_log("Registration error: " . $e->getMessage());
        return false;
    }
}

function loginUser($username, $password) {
    startSession();
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("SELECT id, username, password FROM users WHERE username = ?");
    $stmt->bind_param("s", $username);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($user = $result->fetch_assoc()) {
        if (password_verify($password, $user['password'])) {
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            // Update login tracking
            updateUserLogin($user['id']);
            return true;
        }
    }
    return false;
}

function isLoggedIn() {
    startSession();
    return isset($_SESSION['user_id']);
}

function getCurrentUserId() {
    startSession();
    return $_SESSION['user_id'] ?? null;
}

function getUserRoleInLeague($userId, $leagueId) {
    startSession();
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("SELECT role FROM league_members WHERE user_id = ? AND league_id = ?");
    $stmt->bind_param("ii", $userId, $leagueId);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($row = $result->fetch_assoc()) {
        return $row['role'];
    }
    return null;
}

function createLeague($name, $accessCode = null, $initialBudget = 100, $defaultTime = '20:00', $maxPortieri = 3, $maxDifensori = 8, $maxCentrocampisti = 8, $maxAttaccanti = 6, $numeroTitolari = 11, $bonus_settings = null, $auto_lineup_mode = 0, $teamName = null, $coachName = null) {
    startSession();
    $conn = getDbConnection();
    $userId = getCurrentUserId();
    
    if (!$userId) return false;
    
    $stmt = $conn->prepare("INSERT INTO leagues (name, access_code, creator_id, initial_budget, default_deadline_time, max_portieri, max_difensori, max_centrocampisti, max_attaccanti, numero_titolari, auto_lineup_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmt->bind_param("ssissiiiiii", $name, $accessCode, $userId, $initialBudget, $defaultTime, $maxPortieri, $maxDifensori, $maxCentrocampisti, $maxAttaccanti, $numeroTitolari, $auto_lineup_mode);
    
    try {
        $stmt->execute();
        $leagueId = $conn->insert_id;
        
        // Add creator as admin
        $stmt = $conn->prepare("INSERT INTO league_members (league_id, user_id, role) VALUES (?, ?, 'admin')");
        $stmt->bind_param("ii", $leagueId, $userId);
        $stmt->execute();
        $stmt->close();
        
        // Calcola i valori di default per team_name e coach_name (per il creatore sarà sempre Squadra 1 e Allenatore 1)
        // perché è il primo utente nella lega
        $defaultTeamName = "Squadra 1";
        $defaultCoachName = "Allenatore 1";
        
        // Inserisci riga in user_budget per il creatore con i valori di default già inseriti (incluso logo default_1)
        $defaultLogo = 'default_1';
        $budgetStmt = $conn->prepare("INSERT INTO user_budget (user_id, league_id, budget, team_name, coach_name, team_logo) VALUES (?, ?, ?, ?, ?, ?)");
        $budgetStmt->bind_param("iidsss", $userId, $leagueId, $initialBudget, $defaultTeamName, $defaultCoachName, $defaultLogo);
        $budgetStmt->execute();
        $budgetStmt->close();
        
        error_log("createLeague: Created league ID: $leagueId with default team_name='$defaultTeamName' and coach_name='$defaultCoachName'");
        
        // Salva bonus/malus: modello A -> ogni lega deve avere SEMPRE una riga.
        // Se $bonus_settings non è presente, salviamo comunque i default.
        {
            $defaults = [
                'enable_bonus_malus' => 1,
                'enable_goal' => 1, 'bonus_goal' => 3.0,
                'enable_assist' => 1, 'bonus_assist' => 1.0,
                'enable_yellow_card' => 1, 'malus_yellow_card' => -0.5,
                'enable_red_card' => 1, 'malus_red_card' => -1.0,
                'enable_goals_conceded' => 1, 'malus_goals_conceded' => -1.0,
                'enable_own_goal' => 1, 'malus_own_goal' => -2.0,
                'enable_penalty_missed' => 1, 'malus_penalty_missed' => -3.0,
                'enable_penalty_saved' => 1, 'bonus_penalty_saved' => 3.0,
                'enable_clean_sheet' => 1, 'bonus_clean_sheet' => 1.0,
            ];
            $incoming = ($bonus_settings && is_array($bonus_settings)) ? $bonus_settings : [];
            $bs = array_merge($defaults, $incoming);

            // Cast robusto
            foreach ([
                'enable_bonus_malus','enable_goal','enable_assist','enable_yellow_card','enable_red_card',
                'enable_goals_conceded','enable_own_goal','enable_penalty_missed','enable_penalty_saved','enable_clean_sheet'
            ] as $k) {
                $bs[$k] = (int)($bs[$k] ?? 0);
            }
            foreach ([
                'bonus_goal','bonus_assist','malus_yellow_card','malus_red_card',
                'malus_goals_conceded','malus_own_goal','malus_penalty_missed','bonus_penalty_saved','bonus_clean_sheet'
            ] as $k) {
                $bs[$k] = (float)($bs[$k] ?? 0.0);
            }

            try {
                $stmt = $conn->prepare("REPLACE INTO league_bonus_settings (league_id, enable_bonus_malus, enable_goal, bonus_goal, enable_assist, bonus_assist, enable_yellow_card, malus_yellow_card, enable_red_card, malus_red_card, enable_goals_conceded, malus_goals_conceded, enable_own_goal, malus_own_goal, enable_penalty_missed, malus_penalty_missed, enable_penalty_saved, bonus_penalty_saved, enable_clean_sheet, bonus_clean_sheet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                if (!$stmt) {
                    error_log("createLeague bonus settings prepare failed: " . $conn->error);
                } else {
                    // 20 params: i i i d i d i d i d i d i d i d i d i d
                    $stmt->bind_param(
                        "iiididididididididid",
                        $leagueId,
                        $bs['enable_bonus_malus'],
                        $bs['enable_goal'],
                        $bs['bonus_goal'],
                        $bs['enable_assist'],
                        $bs['bonus_assist'],
                        $bs['enable_yellow_card'],
                        $bs['malus_yellow_card'],
                        $bs['enable_red_card'],
                        $bs['malus_red_card'],
                        $bs['enable_goals_conceded'],
                        $bs['malus_goals_conceded'],
                        $bs['enable_own_goal'],
                        $bs['malus_own_goal'],
                        $bs['enable_penalty_missed'],
                        $bs['malus_penalty_missed'],
                        $bs['enable_penalty_saved'],
                        $bs['bonus_penalty_saved'],
                        $bs['enable_clean_sheet'],
                        $bs['bonus_clean_sheet']
                    );
                    $ok = $stmt->execute();
                    if (!$ok) {
                        error_log("createLeague bonus settings execute failed: " . $stmt->error);
                    }
                    $stmt->close();
                }
            } catch (Throwable $e) {
                error_log("createLeague bonus settings exception: " . $e->getMessage());
            }
        }
        
        return $leagueId;
    } catch (Exception $e) {
        error_log("League creation error: " . $e->getMessage());
        return false;
    }
}

function joinLeague($leagueIdOrName, $accessCode = null, $searchType = 'id', $teamName = null, $coachName = null) {
    startSession();
    $conn = getDbConnection();
    $userId = getCurrentUserId();
    if (!$userId) return false;

    // Cerca per nome se richiesto
    if ($searchType === 'name') {
        $stmt = $conn->prepare("SELECT id, access_code FROM leagues WHERE name LIKE ? LIMIT 1");
        $like = "%" . $leagueIdOrName . "%";
        $stmt->bind_param("s", $like);
        $stmt->execute();
        $res = $stmt->get_result();
        if ($row = $res->fetch_assoc()) {
            $leagueId = $row['id'];
            $dbAccessCode = $row['access_code'];
        } else {
            return 'not_found';
        }
    } else {
        $leagueId = $leagueIdOrName;
        $stmt = $conn->prepare("SELECT access_code FROM leagues WHERE id = ?");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        $res = $stmt->get_result();
        if ($row = $res->fetch_assoc()) {
            $dbAccessCode = $row['access_code'];
        } else {
            return 'not_found';
        }
    }

    // Controlla se già iscritto
    $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $leagueId, $userId);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($res->num_rows > 0) {
        return 'already_joined';
    }

    // Controlla codice accesso
    if ($dbAccessCode && $dbAccessCode !== $accessCode) {
        return false;
    }

    // Iscrivi utente
    $stmt = $conn->prepare("INSERT INTO league_members (league_id, user_id, role) VALUES (?, ?, 'user')");
    $stmt->bind_param("ii", $leagueId, $userId);
    $stmt->execute();
    $stmt->close();

    // Budget iniziale
    $stmt = $conn->prepare("SELECT initial_budget FROM leagues WHERE id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    $budget = 100;
    if ($row = $res->fetch_assoc()) {
        $budget = $row['initial_budget'];
    }
    $stmt->close();
    
    // Calcola i valori di default per team_name e coach_name PRIMA di creare il record
    // Questo assicura che il record venga creato già con i valori di default
    $defaultTeamNumber = getNextDefaultTeamNumber($leagueId);
    $defaultCoachNumber = getNextDefaultCoachNumber($leagueId);
    $defaultTeamName = "Squadra $defaultTeamNumber";
    $defaultCoachName = "Allenatore $defaultCoachNumber";
    
    // Crea il record in user_budget con i valori di default già inseriti (incluso logo default_1)
    $defaultLogo = 'default_1';
    $stmt = $conn->prepare("INSERT INTO user_budget (user_id, league_id, budget, team_name, coach_name, team_logo) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->bind_param("iidsss", $userId, $leagueId, $budget, $defaultTeamName, $defaultCoachName, $defaultLogo);
    $stmt->execute();
    $stmt->close();
    
    // Recupera il nome della lega per il log
    $stmt = $conn->prepare("SELECT name FROM leagues WHERE id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    $leagueName = 'Unknown';
    if ($row = $res->fetch_assoc()) {
        $leagueName = $row['name'];
    }
    $stmt->close();
    
    error_log("joinLeague: User $userId joined league ID: $leagueId, Name: $leagueName");
    error_log("joinLeague: Created user_budget record with default team_name='$defaultTeamName' and coach_name='$defaultCoachName'");

    return true;
}

function getUserLeagues() {
    startSession();
    $conn = getDbConnection();
    $userId = getCurrentUserId();
    
    if (!$userId) return [];
    
    $stmt = $conn->prepare("
        SELECT l.*, lm.role 
        FROM leagues l 
        JOIN league_members lm ON l.id = lm.league_id 
        WHERE lm.user_id = ?
    ");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    $result = $stmt->get_result();
    
    $leagues = [];
    while ($row = $result->fetch_assoc()) {
        $leagues[] = $row;
    }
    
    return $leagues;
}

function isUserAdmin($userId) {
    startSession();
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("SELECT role FROM league_members WHERE user_id = ? AND role = 'admin' LIMIT 1");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    $result = $stmt->get_result();
    
    return $result->num_rows > 0;
}

function isUserAdminInLeague($userId, $leagueId) {
    startSession();
    $conn = getDbConnection();
    $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE user_id = ? AND league_id = ? AND role = 'admin' LIMIT 1");
    $stmt->bind_param("ii", $userId, $leagueId);
    $stmt->execute();
    $result = $stmt->get_result();
    return $result->num_rows > 0;
}

function setUserLeagueRole($conn, $userId, $leagueId) {
    // Controllo ruolo nella lega
    $stmt = $conn->prepare("SELECT role FROM league_members WHERE user_id = ? AND league_id = ?");
    $stmt->bind_param("ii", $userId, $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    $isAdminLega = false;
    $isPagellatoreLega = false;
    if ($row = $res->fetch_assoc()) {
        $isAdminLega = ($row['role'] === 'admin');
        $isPagellatoreLega = ($row['role'] === 'pagellatore');
    }
    $_SESSION['is_admin_lega'] = $isAdminLega;
    $_SESSION['is_pagellatore_lega'] = $isPagellatoreLega;
    $_SESSION['current_league_id'] = $leagueId;
}

function isAdminLega() {
    return isset($_SESSION['is_admin_lega']) && $_SESSION['is_admin_lega'];
}

function isPagellatoreLega() {
    return isset($_SESSION['is_pagellatore_lega']) && $_SESSION['is_pagellatore_lega'];
}

function searchLeaguesByName($query) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("SELECT id, name FROM leagues WHERE name LIKE ? LIMIT 5");
    $like = "%" . $query . "%";
    $stmt->bind_param("s", $like);
    $stmt->execute();
    $res = $stmt->get_result();
    $leagues = [];
    while ($row = $res->fetch_assoc()) {
        $leagues[] = $row;
    }
    return $leagues;
}

function getAvailableLeaguesForUser($userId) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("
        SELECT
            l.*,
            COALESCE(mc.user_count, 0) AS user_count,
            COALESCE(lms.market_locked, 0) AS market_locked
        FROM leagues l
        LEFT JOIN league_members lm_self
            ON lm_self.league_id = l.id AND lm_self.user_id = ?
        LEFT JOIN (
            SELECT league_id, COUNT(*) AS user_count
            FROM league_members
            GROUP BY league_id
        ) mc ON mc.league_id = l.id
        LEFT JOIN league_market_settings lms
            ON lms.league_id = l.id
        WHERE lm_self.user_id IS NULL
        ORDER BY l.name ASC
    ");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    $result = $stmt->get_result();

    $leagues = [];
    while ($row = $result->fetch_assoc()) {
        $leagues[] = $row;
    }

    $stmt->close();
    return $leagues;
}

function getUserLeaguePrefs($userId) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("SELECT league_id, favorite, archived, notifications_enabled FROM user_league_prefs WHERE user_id = ?");
    if (!$stmt) {
        $stmt = $conn->prepare("SELECT league_id, favorite, archived FROM user_league_prefs WHERE user_id = ?");
    }
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    $res = $stmt->get_result();
    $prefs = [];
    while ($row = $res->fetch_assoc()) {
        $prefs[$row['league_id']] = [
            'favorite' => (bool)$row['favorite'],
            'archived' => (bool)$row['archived'],
            'notifications_enabled' => !isset($row['notifications_enabled']) ? true : (bool)$row['notifications_enabled']
        ];
    }
    return $prefs;
}

function setUserLeaguePref($userId, $leagueId, $favorite, $archived, $notificationsEnabled = 1) {
    $conn = getDbConnection();
    $check = $conn->query("SHOW COLUMNS FROM user_league_prefs LIKE 'notifications_enabled'");
    if ($check && $check->num_rows === 0) {
        $conn->query("ALTER TABLE user_league_prefs ADD COLUMN notifications_enabled TINYINT(1) NOT NULL DEFAULT 1");
    }
    $stmt = $conn->prepare("INSERT INTO user_league_prefs (user_id, league_id, favorite, archived, notifications_enabled) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE favorite = VALUES(favorite), archived = VALUES(archived), notifications_enabled = VALUES(notifications_enabled)");
    $stmt->bind_param("iiiii", $userId, $leagueId, $favorite, $archived, $notificationsEnabled);
    $stmt->execute();
}

function getLeagueById($leagueId) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("SELECT * FROM leagues WHERE id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    return $res->fetch_assoc();
}

// Helper: costruisce la miglior formazione automatica (1 P + D/C/A che sommano a numero_titolari-1)
if (!function_exists('build_auto_lineup')) {
function build_auto_lineup($uid, $league, $rose, $voti, $conn) {
    $numero_titolari = isset($league['numero_titolari']) ? (int)$league['numero_titolari'] : 11;
    $slots_di_movimento = max(0, $numero_titolari - 1); // escluso il portiere

    // Recupera ruoli dei giocatori in rosa dell'utente
    $ruoliByPlayer = [];
    if (isset($rose[$uid]) && count($rose[$uid]) > 0) {
        $in = implode(',', array_fill(0, count($rose[$uid]), '?'));
        $types = str_repeat('i', count($rose[$uid]));
        $stmt = $conn->prepare("SELECT id, role FROM players WHERE id IN ($in)");
        $stmt->bind_param($types, ...$rose[$uid]);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $ruoliByPlayer[$row['id']] = $row['role'];
        }
    }

    // Separa voti per ruolo
    $votiByRole = ['P'=>[], 'D'=>[], 'C'=>[], 'A'=>[]];
    foreach ($ruoliByPlayer as $pid => $role) {
        if (isset($voti[$pid])) {
            $votiByRole[$role][$pid] = $voti[$pid];
        }
    }

    // Scegli 1 portiere con voto più alto
    arsort($votiByRole['P']);
    $titolari = [];
    $portieri = array_keys($votiByRole['P']);
    if (!empty($portieri)) {
        $titolari[] = $portieri[0];
    } else {
        // Nessun portiere con voto: metti slot vuoto
        $titolari[] = null;
    }

    // Genera combinazioni D/C/A che sommano a $slots_di_movimento (limiti ragionevoli)
    $bestCombo = null;
    $bestScore = -INF;
    $bestPick = ['D'=>[], 'C'=>[], 'A'=>[]];

    $maxD = min(6, $slots_di_movimento);
    $maxC = min(6, $slots_di_movimento);
    $maxA = min(4, $slots_di_movimento);

    for ($d = 2; $d <= $maxD; $d++) {
        for ($c = 2; $c <= $maxC; $c++) {
            $a = $slots_di_movimento - $d - $c;
            if ($a < 1 || $a > $maxA) continue;
            // Punteggio della combinazione: somma dei migliori N voti per ruolo
            $pick = ['D'=>[], 'C'=>[], 'A'=>[]];
            $score = 0;
            // Difensori
            arsort($votiByRole['D']);
            $pick['D'] = array_slice(array_keys($votiByRole['D']), 0, $d);
            foreach ($pick['D'] as $pid) $score += $voti[$pid] ?? 0;
            // Centrocampisti
            arsort($votiByRole['C']);
            $pick['C'] = array_slice(array_keys($votiByRole['C']), 0, $c);
            foreach ($pick['C'] as $pid) $score += $voti[$pid] ?? 0;
            // Attaccanti
            arsort($votiByRole['A']);
            $pick['A'] = array_slice(array_keys($votiByRole['A']), 0, $a);
            foreach ($pick['A'] as $pid) $score += $voti[$pid] ?? 0;

            if ($score > $bestScore) {
                $bestScore = $score;
                $bestCombo = [$d, $c, $a];
                $bestPick = $pick;
            }
        }
    }

    // Assembla titolari finali: già abbiamo 1 P, poi D, C, A della miglior combo.
    $titolari = array_merge($titolari, $bestPick['D'], $bestPick['C'], $bestPick['A']);

    // Riempie con null se mancano slot (giocatori senza voto o ruoli insufficienti)
    while (count($titolari) < $numero_titolari) $titolari[] = null;

    return $titolari;
}
}

function getLeagueStandings($leagueId, $limit = 5) {
    $conn = getDbConnection();

    // Classifica basata SOLO su giornate calcolate (matchday_results)
    $stmt = $conn->prepare("SELECT u.id, u.username, ub.team_name FROM users u JOIN user_budget ub ON u.id = ub.user_id WHERE ub.league_id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $utenti = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    $stmt = $conn->prepare("SELECT user_id, SUM(punteggio) as totale FROM matchday_results WHERE league_id = ? GROUP BY user_id");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $calcResults = [];
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $calcResults[$row['user_id']] = round(floatval($row['totale']), 1);
    }
    $stmt->close();

    $classifica = [];
    foreach ($utenti as $utente) {
        $uid = $utente['id'];
        $classifica[] = [
            'id' => $utente['id'],
            'username' => $utente['username'],
            'team_name' => $utente['team_name'],
            'punteggio' => $calcResults[$uid] ?? 0,
        ];
    }

    usort($classifica, function($a, $b) {
        return $b['punteggio'] <=> $a['punteggio'];
    });

    $result = array_slice($classifica, 0, $limit);
    error_log("getLeagueStandings: Returning " . count($result) . " standings (from matchday_results, limit: $limit)");
    return $result;
}

function getNextDefaultTeamNumber($leagueId) {
    $conn = getDbConnection();
    
    // Recupera tutti i team_name nella lega che seguono il pattern "Squadra N" o "SquadraN"
    $stmt = $conn->prepare("SELECT team_name FROM user_budget WHERE league_id = ? AND team_name != '' AND team_name REGEXP '^Squadra[[:space:]]*[0-9]+$'");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    
    $usedNumbers = [];
    while ($row = $res->fetch_assoc()) {
        // Estrai il numero dal nome (es. "Squadra 1" -> 1, "Squadra2" -> 2)
        if (preg_match('/Squadra\s*(\d+)/i', $row['team_name'], $matches)) {
            $usedNumbers[] = (int)$matches[1];
        }
    }
    
    // Trova il prossimo numero disponibile
    $nextNumber = 1;
    while (in_array($nextNumber, $usedNumbers)) {
        $nextNumber++;
    }
    
    return $nextNumber;
}

function getNextDefaultCoachNumber($leagueId) {
    $conn = getDbConnection();
    
    // Recupera tutti i coach_name nella lega che seguono il pattern "Allenatore N" o "AllenatoreN"
    $stmt = $conn->prepare("SELECT coach_name FROM user_budget WHERE league_id = ? AND coach_name != '' AND coach_name REGEXP '^Allenatore[[:space:]]*[0-9]+$'");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    
    $usedNumbers = [];
    while ($row = $res->fetch_assoc()) {
        // Estrai il numero dal nome (es. "Allenatore 1" -> 1, "Allenatore2" -> 2)
        if (preg_match('/Allenatore\s*(\d+)/i', $row['coach_name'], $matches)) {
            $usedNumbers[] = (int)$matches[1];
        }
    }
    
    // Trova il prossimo numero disponibile
    $nextNumber = 1;
    while (in_array($nextNumber, $usedNumbers)) {
        $nextNumber++;
    }
    
    return $nextNumber;
}

function needsTeamInfo($userId, $leagueId) {
    $conn = getDbConnection();
    
    error_log("needsTeamInfo: Checking for userId=$userId, leagueId=$leagueId");
    
    // Verifica se l'utente ha un record in user_budget per questa lega
    $stmt = $conn->prepare("SELECT team_name, coach_name FROM user_budget WHERE user_id = ? AND league_id = ?");
    $stmt->bind_param("ii", $userId, $leagueId);
    $stmt->execute();
    $res = $stmt->get_result();
    
    if ($row = $res->fetch_assoc()) {
        // Se team_name o coach_name sono vuoti o null, serve inserirli
        $teamName = trim($row['team_name'] ?? '');
        $coachName = trim($row['coach_name'] ?? '');
        
        error_log("needsTeamInfo: Found record - team_name='$teamName', coach_name='$coachName'");
        $needsInfo = empty($teamName) || empty($coachName);
        error_log("needsTeamInfo: Result=" . ($needsInfo ? 'true (needs info)' : 'false (has info)'));
        
        return $needsInfo;
    }
    
    // Se non esiste il record, serve crearlo con i dati
    error_log("needsTeamInfo: No record found in user_budget - returning true");
    return true;
}

function updateTeamInfo($userId, $leagueId, $teamName, $coachName) {
    $conn = getDbConnection();
    
    error_log("updateTeamInfo: UserId=$userId, LeagueId=$leagueId, TeamName=$teamName, CoachName=$coachName");
    
    // Check if team name or coach name already exists in the league
    $stmt = $conn->prepare("SELECT 1 FROM user_budget WHERE league_id = ? AND (team_name = ? OR coach_name = ?) AND user_id != ?");
    $stmt->bind_param("issi", $leagueId, $teamName, $coachName, $userId);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($res->num_rows > 0) {
        error_log("updateTeamInfo: Name already exists in league");
        return 'name_exists';
    }
    $stmt->close();
    
    // Verifica se esiste già un record
    $checkStmt = $conn->prepare("SELECT 1 FROM user_budget WHERE user_id = ? AND league_id = ?");
    $checkStmt->bind_param("ii", $userId, $leagueId);
    $checkStmt->execute();
    $checkRes = $checkStmt->get_result();
    $recordExists = $checkRes->num_rows > 0;
    $checkStmt->close();
    
    if ($recordExists) {
        // Update team info
        error_log("updateTeamInfo: Record exists, updating...");
        $stmt = $conn->prepare("UPDATE user_budget SET team_name = ?, coach_name = ? WHERE user_id = ? AND league_id = ?");
        $stmt->bind_param("ssii", $teamName, $coachName, $userId, $leagueId);
    } else {
        // Insert new record (dovrebbe esistere già, ma per sicurezza)
        error_log("updateTeamInfo: Record does not exist, creating new one...");
        $budgetStmt = $conn->prepare("SELECT initial_budget FROM leagues WHERE id = ?");
        $budgetStmt->bind_param("i", $leagueId);
        $budgetStmt->execute();
        $budgetRes = $budgetStmt->get_result();
        $budget = 100;
        if ($budgetRow = $budgetRes->fetch_assoc()) {
            $budget = $budgetRow['initial_budget'];
        }
        $budgetStmt->close();
        
        $stmt = $conn->prepare("INSERT INTO user_budget (user_id, league_id, budget, team_name, coach_name) VALUES (?, ?, ?, ?, ?)");
        $stmt->bind_param("iidss", $userId, $leagueId, $budget, $teamName, $coachName);
    }
    
    if ($stmt->execute()) {
        error_log("updateTeamInfo: Successfully saved team info");
        $stmt->close();
        return true;
    } else {
        error_log("updateTeamInfo: Error executing query: " . $stmt->error);
        $stmt->close();
        return false;
    }
}

function getLeagueJoinRequests($leagueId) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("
        SELECT ljr.*, u.username 
        FROM league_join_requests ljr 
        JOIN users u ON ljr.user_id = u.id 
        WHERE ljr.league_id = ? AND ljr.status = 'pending'
        ORDER BY ljr.requested_at ASC
    ");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

function approveJoinRequest($requestId) {
    $conn = getDbConnection();
    
    // Get request details
    $stmt = $conn->prepare("SELECT * FROM league_join_requests WHERE id = ? AND status = 'pending'");
    $stmt->bind_param("i", $requestId);
    $stmt->execute();
    $request = $stmt->get_result()->fetch_assoc();
    
    if (!$request) {
        return false;
    }
    
    // Check if user is already in the league
    $stmt = $conn->prepare("SELECT 1 FROM league_members WHERE league_id = ? AND user_id = ?");
    $stmt->bind_param("ii", $request['league_id'], $request['user_id']);
    $stmt->execute();
    if ($stmt->get_result()->num_rows > 0) {
        return 'already_joined';
    }
    
    // Check if team name or coach name already exists
    $stmt = $conn->prepare("SELECT 1 FROM user_budget WHERE league_id = ? AND (team_name = ? OR coach_name = ?)");
    $stmt->bind_param("iss", $request['league_id'], $request['team_name'], $request['coach_name']);
    $stmt->execute();
    if ($stmt->get_result()->num_rows > 0) {
        return 'name_exists';
    }
    
    // Get league budget
    $stmt = $conn->prepare("SELECT initial_budget FROM leagues WHERE id = ?");
    $stmt->bind_param("i", $request['league_id']);
    $stmt->execute();
    $league = $stmt->get_result()->fetch_assoc();
    $budget = $league['initial_budget'] ?? 100;
    
    // Add user to league
    $stmt = $conn->prepare("INSERT INTO league_members (league_id, user_id, role) VALUES (?, ?, 'user')");
    $stmt->bind_param("ii", $request['league_id'], $request['user_id']);
    $stmt->execute();
    
    // Add user budget with team info
    $stmt = $conn->prepare("INSERT INTO user_budget (user_id, league_id, budget, team_name, coach_name) VALUES (?, ?, ?, ?, ?)");
    $stmt->bind_param("iidss", $request['user_id'], $request['league_id'], $budget, $request['team_name'], $request['coach_name']);
    $stmt->execute();
    
    // Update request status
    $stmt = $conn->prepare("UPDATE league_join_requests SET status = 'approved' WHERE id = ?");
    $stmt->bind_param("i", $requestId);
    $stmt->execute();
    
    return true;
}

function rejectJoinRequest($requestId) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("UPDATE league_join_requests SET status = 'rejected' WHERE id = ?");
    $stmt->bind_param("i", $requestId);
    return $stmt->execute();
}

function getLeagueMarketSettings($leagueId) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("SELECT * FROM league_market_settings WHERE league_id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    
    if (!$result) {
        // Create default settings
        $stmt = $conn->prepare("INSERT INTO league_market_settings (league_id, market_locked, require_approval) VALUES (?, 0, 0)");
        $stmt->bind_param("i", $leagueId);
        $stmt->execute();
        
        return ['league_id' => $leagueId, 'market_locked' => 0, 'require_approval' => 0];
    }
    
    return $result;
}

function updateLeagueMarketSettings($leagueId, $marketLocked, $requireApproval) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("REPLACE INTO league_market_settings (league_id, market_locked, require_approval) VALUES (?, ?, ?)");
    $stmt->bind_param("iii", $leagueId, $marketLocked, $requireApproval);
    return $stmt->execute();
}

function getUserMarketBlocks($leagueId) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("
        SELECT umb.*, u.username, ub.team_name 
        FROM user_market_blocks umb 
        JOIN users u ON umb.user_id = u.id 
        JOIN user_budget ub ON umb.user_id = ub.user_id AND umb.league_id = ub.league_id
        WHERE umb.league_id = ?
        ORDER BY ub.team_name
    ");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

function getAllLeagueMembersWithMarketBlocks($leagueId) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("
        SELECT 
            lm.user_id,
            u.username,
            ub.team_name,
            ub.coach_name,
            COALESCE(umb.blocked, 0) as blocked
        FROM league_members lm
        JOIN users u ON lm.user_id = u.id
        LEFT JOIN user_budget ub ON lm.user_id = ub.user_id AND lm.league_id = ub.league_id
        LEFT JOIN user_market_blocks umb ON lm.user_id = umb.user_id AND lm.league_id = umb.league_id
        WHERE lm.league_id = ? AND lm.role != 'admin'
        ORDER BY ub.team_name, u.username
    ");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

function updateUserMarketBlock($userId, $leagueId, $blocked) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("REPLACE INTO user_market_blocks (user_id, league_id, blocked) VALUES (?, ?, ?)");
    $stmt->bind_param("iii", $userId, $leagueId, $blocked);
    return $stmt->execute();
}

function getMatchdayDeadline($leagueId, $giornata) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("SELECT deadline FROM matchdays WHERE league_id = ? AND giornata = ?");
    $stmt->bind_param("ii", $leagueId, $giornata);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($row = $result->fetch_assoc()) {
        return $row['deadline'];
    }
    
    return null;
}

function isMatchdayExpired($leagueId, $giornata) {
    $deadline = getMatchdayDeadline($leagueId, $giornata);
    
    if (!$deadline) {
        return false; // Se non c'è deadline, non è scaduta
    }
    
    $now = new DateTime();
    $deadlineDate = new DateTime($deadline);
    
    return $now >= $deadlineDate;
}

function getTimeUntilDeadline($leagueId, $giornata) {
    $deadline = getMatchdayDeadline($leagueId, $giornata);
    
    if (!$deadline) {
        return null;
    }
    
    $now = new DateTime();
    $deadlineDate = new DateTime($deadline);
    
    if ($now >= $deadlineDate) {
        return null; // Scaduta
    }
    
    return $deadlineDate->diff($now);
}

function isMarketBlockedold($userId, $leagueId) {
    $conn = getDbConnection();
    
    // Check global market lock
    $stmt = $conn->prepare("SELECT market_locked FROM league_market_settings WHERE league_id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    
    if ($result && $result['market_locked']) {
        return ['blocked' => true, 'reason' => 'global'];
    }
    
    // Check individual user block
    $stmt = $conn->prepare("SELECT blocked FROM user_market_blocks WHERE user_id = ? AND league_id = ?");
    $stmt->bind_param("ii", $userId, $leagueId);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    
    if ($result && $result['blocked']) {
        return ['blocked' => true, 'reason' => 'individual'];
    }
    
    return ['blocked' => false, 'reason' => null];
}
function isMarketBlocked($userId, $leagueId) {
    $conn = getDbConnection();
    
    // Controlla blocco globale
    $stmt = $conn->prepare("SELECT market_locked FROM league_market_settings WHERE league_id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    
    $globalBlocked = $result && $result['market_locked'];
    
    // Controlla blocco individuale
    $stmt = $conn->prepare("SELECT blocked FROM user_market_blocks WHERE user_id = ? AND league_id = ?");
    $stmt->bind_param("ii", $userId, $leagueId);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    
    $userBlocked = $result && $result['blocked'];
    
    // Logica finale
    if ($globalBlocked && $userBlocked) {
        // Blocco globale + blocco utente => mercato bloccato per tutti tranne l'utente
        return ['blocked' => false, 'reason' => 'exception']; 
    } elseif ($globalBlocked && !$userBlocked) {
        // Solo blocco globale attivo => mercato bloccato per tutti
        return ['blocked' => true, 'reason' => 'global'];
    } elseif (!$globalBlocked && $userBlocked) {
        // Solo utente bloccato => bloccato solo lui
        return ['blocked' => true, 'reason' => 'individual'];
    } else {
        // Nessun blocco attivo
        return ['blocked' => false, 'reason' => null];
    }
}

function getUserPendingRequests($userId) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("
        SELECT r.*, l.name AS league_name
        FROM league_join_requests r
        JOIN leagues l ON l.id = r.league_id
        WHERE r.user_id = ? AND r.status = 'pending'
        ORDER BY r.requested_at DESC
    ");
    $stmt->bind_param("i", $userId);
    $stmt->execute();
    $result = $stmt->get_result();
    return $result->fetch_all(MYSQLI_ASSOC);
}

function getLeagueBonusSettings($leagueId) {
    $conn = getDbConnection();
    $bonus_defaults = [
        'enable_bonus_malus' => 0,
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
    
    $stmt = $conn->prepare("SELECT * FROM league_bonus_settings WHERE league_id = ?");
    $stmt->bind_param("i", $leagueId);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($row = $result->fetch_assoc()) {
        return array_merge($bonus_defaults, $row);
    }
    
    return $bonus_defaults;
}

function calculatePlayerScore($playerRating, $bonus_settings) {
    $base = floatval($playerRating['rating']);
    $bonus = 0;
    
    if ($bonus_settings['enable_bonus_malus']) {
        if ($bonus_settings['enable_goal']) {
            $bonus += (int)($playerRating['goals'] ?? 0) * $bonus_settings['bonus_goal'];
        }
        if ($bonus_settings['enable_assist']) {
            $bonus += (int)($playerRating['assists'] ?? 0) * $bonus_settings['bonus_assist'];
        }
        if ($bonus_settings['enable_yellow_card']) {
            $bonus += (int)($playerRating['yellow_cards'] ?? 0) * $bonus_settings['malus_yellow_card'];
        }
        if ($bonus_settings['enable_red_card']) {
            $bonus += (int)($playerRating['red_cards'] ?? 0) * $bonus_settings['malus_red_card'];
        }
        if ($bonus_settings['enable_goals_conceded']) {
            $bonus += (int)($playerRating['goals_conceded'] ?? 0) * $bonus_settings['malus_goals_conceded'];
        }
        if ($bonus_settings['enable_own_goal']) {
            $bonus += (int)($playerRating['own_goals'] ?? 0) * $bonus_settings['malus_own_goal'];
        }
        if ($bonus_settings['enable_penalty_missed']) {
            $bonus += (int)($playerRating['penalty_missed'] ?? 0) * $bonus_settings['malus_penalty_missed'];
        }
        if ($bonus_settings['enable_penalty_saved']) {
            $bonus += (int)($playerRating['penalty_saved'] ?? 0) * $bonus_settings['bonus_penalty_saved'];
        }
        if ($bonus_settings['enable_clean_sheet']) {
            $bonus += (int)($playerRating['clean_sheet'] ?? 0) * $bonus_settings['bonus_clean_sheet'];
        }
    }
    
    return $base + $bonus;
}
// Funzioni per il reset password
function generateResetToken($email) {
    $conn = getDbConnection();
    
    // Verifica che l'email esista
    $stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");
    if (!$stmt) {
        error_log("Errore prepare SELECT users: " . $conn->error);
        return false;
    }
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows === 0) {
        $stmt->close();
        return false; // Email non trovata
    }
    $stmt->close();
    
    // Genera token unico
    $token = bin2hex(random_bytes(32));
    $expires = date('Y-m-d H:i:s', strtotime('+1 hour'));
    
    // Invalida eventuali token precedenti per questa email
    // (gestisce il caso in cui la tabella non esista ancora)
    $stmt = $conn->prepare("UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0");
    if ($stmt) {
        $stmt->bind_param("s", $email);
        $stmt->execute();
        $stmt->close();
    } else {
        // Se la tabella non esiste, possiamo continuare (verrà creata con l'INSERT)
        error_log("Attenzione: tabella password_resets potrebbe non esistere: " . $conn->error);
    }
    
    // Inserisci nuovo token
    $stmt = $conn->prepare("INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)");
    if (!$stmt) {
        error_log("Errore prepare INSERT password_resets: " . $conn->error);
        return false;
    }
    $stmt->bind_param("sss", $email, $token, $expires);
    
    if ($stmt->execute()) {
        $stmt->close();
        return $token;
    }
    
    $stmt->close();
    return false;
}

function sendResetEmail($email, $token) {
    // Scrivi anche in un file di log accessibile via web (solo per debug)
    $debugLogFile = __DIR__ . '/email_debug.log';
    
    // Crea il file se non esiste
    if (!file_exists($debugLogFile)) {
        @file_put_contents($debugLogFile, '', LOCK_EX);
        @chmod($debugLogFile, 0666); // Permessi leggibili/scrivibili
    }
    
    $writeDebugLog = function($message) use ($debugLogFile) {
        $timestamp = date('Y-m-d H:i:s');
        $logMessage = "[$timestamp] $message\n";
        error_log($logMessage);
        // Scrivi anche nel file di log accessibile
        $result = @file_put_contents($debugLogFile, $logMessage, FILE_APPEND | LOCK_EX);
        if ($result === false) {
            // Se fallisce, prova a loggare l'errore
            error_log("ERRORE: Impossibile scrivere nel file di log: $debugLogFile");
            error_log("Permessi file: " . (file_exists($debugLogFile) ? decoct(fileperms($debugLogFile) & 0777) : 'file non esiste'));
            error_log("Directory scrivibile: " . (is_writable(dirname($debugLogFile)) ? 'SÌ' : 'NO'));
        }
    };
    
    $writeDebugLog("=== SEND RESET EMAIL START ===");
    $writeDebugLog("Email: " . $email);
    $writeDebugLog("Token: " . substr($token, 0, 10) . "...");
    
    $mailSent = false;
    
    // PROVA PRIMA CON IL SERVIZIO EMAIL DI ALTERVISTA (funzione mail() nativa)
    if (function_exists('mail')) {
        $writeDebugLog("Funzione mail() disponibile: OK");
        
        // Prepara l'email usando la funzione mail() nativa
        $to = $email;
        $subject = 'Reset Password - FantaCoppa';
        $fromEmail = 'noreply@fantacoppa.com';
        $fromName = 'FantaCoppa';
        
        $resetUrl = "http://" . $_SERVER['HTTP_HOST'] . dirname($_SERVER['PHP_SELF']) . "/reset_password.php?token=" . $token;
        
        $message = "
        <html>
        <head>
            <title>Reset Password FantaCoppa</title>
        </head>
        <body>
            <h2>Reset Password FantaCoppa</h2>
            <p>Hai richiesto il reset della password per il tuo account FantaCoppa.</p>
            <p>Per reimpostare la tua password, clicca sul link seguente:</p>
            <p><a href='$resetUrl'>Reimposta Password</a></p>
            <p>Questo link scadrà tra 1 ora.</p>
            <p>Se non hai richiesto tu questo reset, ignora questa email.</p>
            <br>
            <p>Cordiali saluti,<br>Team FantaCoppa</p>
        </body>
        </html>
        ";
        
        $headers = "MIME-Version: 1.0" . "\r\n";
        $headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
        $headers .= "From: " . $fromName . " <" . $fromEmail . ">" . "\r\n";
        $headers .= "Reply-To: " . $fromEmail . "\r\n";
        $headers .= "X-Mailer: PHP/" . phpversion();
        
        $writeDebugLog("Tentativo invio con mail() nativa...");
        $writeDebugLog("To: " . $to);
        $writeDebugLog("From: " . $fromName . " <" . $fromEmail . ">");
        $writeDebugLog("Subject: " . $subject);
        
        $mailSent = @mail($to, $subject, $message, $headers);
        
        if ($mailSent) {
            $writeDebugLog("=== EMAIL INVIATA CON SUCCESSO (mail() nativa) ===");
            return true;
        } else {
            $writeDebugLog("ERRORE: mail() nativa ha restituito false");
            $writeDebugLog("Tentativo fallback con PHPMailer SMTP...");
        }
    } else {
        $writeDebugLog("ERRORE: Funzione mail() non disponibile su questo server");
        $writeDebugLog("Tentativo con PHPMailer SMTP...");
    }
    
    // FALLBACK: Se mail() nativa non funziona, usa PHPMailer SMTP
    if (!$mailSent && class_exists('PHPMailer\PHPMailer\PHPMailer')) {
        try {
            $writeDebugLog("=== FALLBACK: INIZIO INVIO EMAIL CON PHPMailer SMTP ===");
            $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
            $writeDebugLog("PHPMailer istanziato: OK");
            
            $mail->isSMTP();
            $writeDebugLog("SMTP mode attivato");
            
            // Credenziali SMTP da config.php
            if (!defined('SMTP_HOST')) {
                require_once __DIR__ . '/config.php';
            }
            $mail->Host = SMTP_HOST;
            $mail->SMTPAuth = true;
            $mail->Username = SMTP_USERNAME;
            $mail->Password = SMTP_PASSWORD;
            $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port = SMTP_PORT;
            $mail->Timeout = 30;
            $mail->SMTPOptions = array(
                'ssl' => array(
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true
                )
            );
            
            $writeDebugLog("SMTP Config - Host: " . SMTP_HOST);
            $writeDebugLog("SMTP Config - Port: " . SMTP_PORT);
            
            $mail->setFrom(SMTP_USERNAME, SMTP_FROM_NAME);
            $mail->addAddress($email);
            $mail->isHTML(true);
            $mail->Subject = 'Reset Password - FantaCoppa';
            
            $resetUrl = "http://" . $_SERVER['HTTP_HOST'] . dirname($_SERVER['PHP_SELF']) . "/reset_password.php?token=" . $token;
            
            $mail->Body = "
            <html>
            <head>
                <title>Reset Password FantaCoppa</title>
            </head>
            <body>
                <h2>Reset Password FantaCoppa</h2>
                <p>Hai richiesto il reset della password per il tuo account FantaCoppa.</p>
                <p>Per reimpostare la tua password, clicca sul link seguente:</p>
                <p><a href='$resetUrl'>Reimposta Password</a></p>
                <p>Questo link scadrà tra 1 ora.</p>
                <p>Se non hai richiesto tu questo reset, ignora questa email.</p>
                <br>
                <p>Cordiali saluti,<br>Team FantaCoppa</p>
            </body>
            </html>
            ";
            
            $writeDebugLog("Tentativo invio con PHPMailer...");
            $mailSent = $mail->send();
            
            if ($mailSent) {
                $writeDebugLog("=== EMAIL INVIATA CON SUCCESSO (PHPMailer SMTP) ===");
                return true;
            } else {
                $writeDebugLog("ERROR: PHPMailer send() ha restituito false");
                $writeDebugLog("PHPMailer ErrorInfo: " . $mail->ErrorInfo);
            }
            
        } catch (\PHPMailer\PHPMailer\Exception $e) {
            $writeDebugLog("=== ERRORE DURANTE INVIO EMAIL (PHPMailer) ===");
            $writeDebugLog("Exception message: " . $e->getMessage());
            $writeDebugLog("PHPMailer ErrorInfo: " . (isset($mail) ? $mail->ErrorInfo : 'N/A'));
        } catch (Exception $e) {
            $writeDebugLog("=== ERRORE GENERICO DURANTE INVIO EMAIL ===");
            $writeDebugLog("Exception message: " . $e->getMessage());
        }
    } else if (!$mailSent) {
        $writeDebugLog("ERRORE: PHPMailer class non disponibile");
    }
    
    $writeDebugLog("=== SEND RESET EMAIL END (FALLITO) ===");
    return false;
}

function verifyResetToken($token) {
    $conn = getDbConnection();
    
    $stmt = $conn->prepare("SELECT email, expires_at, used FROM password_resets WHERE token = ?");
    $stmt->bind_param("s", $token);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($row = $result->fetch_assoc()) {
        // Verifica se il token è scaduto o già usato
        if ($row['used'] == 1) {
            return false; // Token già usato
        }
        
        if (strtotime($row['expires_at']) < time()) {
            return false; // Token scaduto
        }
        
        return $row['email'];
    }
    
    return false;
}

function resetPassword($token, $newPassword) {
    $conn = getDbConnection();
    
    $email = verifyResetToken($token);
    if (!$email) {
        return false;
    }
    
    // Hash della nuova password
    $hashedPassword = password_hash($newPassword, PASSWORD_DEFAULT);
    
    // Aggiorna la password
    $stmt = $conn->prepare("UPDATE users SET password = ? WHERE email = ?");
    $stmt->bind_param("ss", $hashedPassword, $email);
    
    if ($stmt->execute()) {
        // Marca il token come usato
        $stmt = $conn->prepare("UPDATE password_resets SET used = 1 WHERE token = ?");
        $stmt->bind_param("s", $token);
        $stmt->execute();
        
        return true;
    }
    
    return false;
}

function getUserByEmail($email) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("SELECT id, username, email FROM users WHERE email = ?");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();
    return $result->fetch_assoc();
}

// Superuser and activity tracking functions
function updateUserActivity($user_id) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("UPDATE users SET last_activity = NOW() WHERE id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
}

function updateUserLogin($user_id) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("UPDATE users SET last_login = NOW(), last_activity = NOW() WHERE id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
}

function logPageView($user_id, $page) {
    $conn = getDbConnection();
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? '';
    
    $stmt = $conn->prepare("INSERT INTO page_views (user_id, page, ip_address, user_agent) VALUES (?, ?, ?, ?)");
    $stmt->bind_param("isss", $user_id, $page, $ip, $user_agent);
    $stmt->execute();
}

function isSuperuser($user_id) {
    $conn = getDbConnection();
    $stmt = $conn->prepare("SELECT is_superuser FROM users WHERE id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result()->fetch_assoc();
    return $result && $result['is_superuser'];
}

function logSuperuserAction($superuser_id, $action_type, $target_user_id, $details) {
    $conn = getDbConnection();
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    
    $stmt = $conn->prepare("INSERT INTO superuser_actions (superuser_id, action_type, target_user_id, details, ip_address) VALUES (?, ?, ?, ?, ?)");
    $stmt->bind_param("isis", $superuser_id, $action_type, $target_user_id, $details, $ip);
    $stmt->execute();
}

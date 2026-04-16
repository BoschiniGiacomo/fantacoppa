<?php
require_once 'db.php';
require_once 'functions.php';
session_start();

// Check if user is logged in
if (!isset($_SESSION['user_id'])) {
    header('Location: index.php');
    exit();
}

$user_id = $_SESSION['user_id'];
$username = $_SESSION['username'] ?? '';
$league_id = isset($_GET['league_id']) ? (int)$_GET['league_id'] : 0;

// Funzione per generare JWT token (stessa logica di api.php)
function generateJWT($userId, $username) {
    if (!defined('JWT_SECRET')) {
        require_once __DIR__ . '/config.php';
    }
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

$authToken = generateJWT($user_id, $username);

// Get league info
$stmt = $conn->prepare("SELECT * FROM leagues WHERE id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$league = $stmt->get_result()->fetch_assoc();

if (!$league) {
    header('Location: dashboard.php');
    exit();
}

// Controlla se l'utente è admin nella lega (tabella league_members)
$stmt = $conn->prepare("SELECT role FROM league_members WHERE league_id = ? AND user_id = ?");
$stmt->bind_param("ii", $league_id, $user_id);
$stmt->execute();
$res = $stmt->get_result();
$row = $res->fetch_assoc();
$is_admin = ($row && $row['role'] === 'admin');

// Determina quale sezione mostrare
$section = isset($_GET['section']) ? $_GET['section'] : ($is_admin ? 'general' : 'team');

// Se l'utente non è admin e sta cercando di accedere a sezioni non permesse, reindirizza alla sezione team
if (!$is_admin && !in_array($section, ['team'])) {
    header('Location: impostazioni.php?league_id=' . $league_id . '&section=team');
    exit();
}

// Get current user's team info
$currentUserTeamInfo = null;
$stmt = $conn->prepare("SELECT team_name, coach_name, team_logo FROM user_budget WHERE user_id = ? AND league_id = ?");
$stmt->bind_param("ii", $user_id, $league_id);
$stmt->execute();
$currentUserTeamInfo = $stmt->get_result()->fetch_assoc();
// Se team_logo è null o vuoto, imposta default_1
if (empty($currentUserTeamInfo['team_logo'])) {
    $currentUserTeamInfo['team_logo'] = 'default_1';
}

// Imposta limiti di default se non presenti
if (!isset($league['max_portieri'])) $league['max_portieri'] = 3;
if (!isset($league['max_difensori'])) $league['max_difensori'] = 8;
if (!isset($league['max_centrocampisti'])) $league['max_centrocampisti'] = 8;
if (!isset($league['max_attaccanti'])) $league['max_attaccanti'] = 6;

// --- Funzione robusta per decimali ---
function parse_decimal($val, $default) {
    if (!isset($val) || $val === '') return $default;
    $val = str_replace(',', '.', trim($val));
    if (!is_numeric($val)) return $default;
    return round(floatval($val), 1);
}

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action'])) {
        // Admin-only actions
        $admin_only_actions = ['update_default_time', 'add_team', 'remove_team', 'update_user_role', 'update_league_settings', 'update_calendar'];
        if (in_array($_POST['action'], $admin_only_actions) && !$is_admin) {
            header('Location: impostazioni.php?league_id=' . $league_id . '&section=team');
            exit();
        }
        
        switch ($_POST['action']) {
            case 'update_default_time':
                $default_time = $_POST['default_time'];
                $max_portieri = (int)$_POST['max_portieri'];
                $max_difensori = (int)$_POST['max_difensori'];
                $max_centrocampisti = (int)$_POST['max_centrocampisti'];
                $max_attaccanti = (int)$_POST['max_attaccanti'];
                $numero_titolari = isset($_POST['numero_titolari']) ? (int)$_POST['numero_titolari'] : 11;
                $access_code = isset($_POST['access_code']) ? trim($_POST['access_code']) : null;
                if ($access_code === '') $access_code = null;
                $stmt = $conn->prepare("UPDATE leagues SET default_deadline_time = ?, max_portieri = ?, max_difensori = ?, max_centrocampisti = ?, max_attaccanti = ?, access_code = ?, numero_titolari = ? WHERE id = ?");
                $stmt->bind_param("siiiisii", $default_time, $max_portieri, $max_difensori, $max_centrocampisti, $max_attaccanti, $access_code, $numero_titolari, $league_id);
                $stmt->execute();
                $league['default_deadline_time'] = $default_time;
                $league['max_portieri'] = $max_portieri;
                $league['max_difensori'] = $max_difensori;
                $league['max_centrocampisti'] = $max_centrocampisti;
                $league['max_attaccanti'] = $max_attaccanti;
                $league['access_code'] = $access_code;
                $league['numero_titolari'] = $numero_titolari;
                $old_numero_titolari = $league['numero_titolari'] ?? 11;
                $old_moduli = [
                    '3-4-3' => [3,4,3], '3-5-2' => [3,5,2], '4-4-2' => [4,4,2], '4-3-3' => [4,3,3], '4-5-1' => [4,5,1], '5-3-2' => [5,3,2], '5-4-1' => [5,4,1], '5-2-3' => [5,2,3], '3-6-1' => [3,6,1], '6-3-1' => [6,3,1], '3-3-4' => [3,3,4], '4-2-4' => [4,2,4], '4-6-0' => [4,6,0], '5-1-4' => [5,1,4], '6-2-2' => [6,2,2], '7-2-1' => [7,2,1], '2-5-3' => [2,5,3], '2-4-4' => [2,4,4], '3-2-5' => [3,2,5], '2-3-5' => [2,3,5],
                    // ... (aggiungi qui tutti i moduli usati in formazione.php)
                ];
                $new_moduli = [];
                foreach ($old_moduli as $nome => $val) {
                    if (array_sum($val) == $numero_titolari - 1) {
                        $new_moduli[$nome] = $val;
                    }
                }
                if ($numero_titolari != $old_numero_titolari) {
                    $res = $conn->query("SELECT * FROM user_lineups WHERE league_id = $league_id");
                    while ($row = $res->fetch_assoc()) {
                        $modulo_prec = $row['modulo'];
                        $titolari = $row['titolari'] ? explode(',', $row['titolari']) : [];
                        $panchina = $row['panchina'] ? explode(',', $row['panchina']) : [];
                        // Trova il modulo più simile
                        $best_modulo = null; $best_diff = null;
                        if (isset($old_moduli[$modulo_prec])) {
                            $prec = $old_moduli[$modulo_prec];
                            foreach ($new_moduli as $nome => $val) {
                                $diff = abs($prec[0]-$val[0]) + abs($prec[1]-$val[1]) + abs($prec[2]-$val[2]);
                                if ($best_diff === null || $diff < $best_diff) {
                                    $best_diff = $diff; $best_modulo = $nome;
                                }
                            }
                        } else {
                            // fallback: primo modulo valido
                            $best_modulo = array_key_first($new_moduli);
                        }
                        $nuovo = $new_moduli[$best_modulo];
                        // Ricostruisci titolari in base al nuovo modulo
                        // 1 portiere, poi ruoli
                        $user_id = $row['user_id'];
                        $giornata = $row['giornata'];
                        // Recupera rosa attuale
                        $rosa = [];
                        $resR = $conn->query("SELECT p.id, p.role FROM user_players up JOIN players p ON up.player_id = p.id WHERE up.user_id = $user_id AND up.league_id = $league_id");
                        while ($r = $resR->fetch_assoc()) $rosa[] = $r;
                        // Mappa id->ruolo
                        $id2ruolo = [];
                        foreach ($rosa as $g) $id2ruolo[$g['id']] = $g['role'];
                        // Costruisci nuovi titolari
                        $nuoviTitolari = [];
                        $ruoliRichiesti = ['P'=>1, 'D'=>$nuovo[0], 'C'=>$nuovo[1], 'A'=>$nuovo[2]];
                        // Prendi i titolari attuali per ruolo
                        $byRole = ['P'=>[], 'D'=>[], 'C'=>[], 'A'=>[]];
                        foreach ($titolari as $pid) if (isset($id2ruolo[$pid])) $byRole[$id2ruolo[$pid]][] = $pid;
                        foreach ($panchina as $pid) if (isset($id2ruolo[$pid])) $byRole[$id2ruolo[$pid]][] = $pid; // panchina dopo
                        // Per ogni ruolo, prendi i primi N disponibili
                        foreach ($ruoliRichiesti as $ruolo => $n) {
                            $presi = 0;
                            foreach ($byRole[$ruolo] as $pid) {
                                if ($presi < $n) { $nuoviTitolari[] = $pid; $presi++; }
                            }
                            // Se mancano slot, aggiungi slot vuoti
                            while ($presi < $n) { $nuoviTitolari[] = ''; $presi++; }
                        }
                        // Tutti gli altri in panchina (escludendo i nuovi titolari)
                        $nuovaPanchina = [];
                        $giaTitolari = array_filter($nuoviTitolari, function ($x) { return $x !== ''; });
                        foreach (array_merge($titolari, $panchina) as $pid) {
                            if ($pid !== '' && !in_array($pid, $giaTitolari) && isset($id2ruolo[$pid])) $nuovaPanchina[] = $pid;
                        }
                        $titolariStr = implode(',', $nuoviTitolari);
                        $panchinaStr = implode(',', $nuovaPanchina);
                        $stmt2 = $conn->prepare("UPDATE user_lineups SET titolari = ?, panchina = ?, modulo = ? WHERE user_id = ? AND league_id = ? AND giornata = ?");
                        $stmt2->bind_param("sssiii", $titolariStr, $panchinaStr, $best_modulo, $user_id, $league_id, $giornata);
                        $stmt2->execute();
                        $stmt2->close();
                    }
                    $_SESSION['avviso_numero_titolari'] = true;
                }
                break;

            case 'add_team':
                $team_name = trim($_POST['team_name']);
                // Evita duplicati nella stessa lega
                $stmt = $conn->prepare("SELECT id FROM teams WHERE league_id = ? AND name = ?");
                $stmt->bind_param("is", $league_id, $team_name);
                $stmt->execute();
                $existing = $stmt->get_result()->fetch_assoc();
                if ($existing) {
                    $_SESSION['error'] = "La squadra '" . htmlspecialchars($team_name, ENT_QUOTES) . "' esiste già in questa lega.";
                } else {
                    // Inserisci e gestisci eventuali errori di vincolo (es. vincolo unico globale su name)
                    try {
                        $stmt = $conn->prepare("INSERT INTO teams (name, league_id) VALUES (?, ?)");
                        $stmt->bind_param("si", $team_name, $league_id);
                        if ($stmt->execute()) {
                            $_SESSION['success'] = "Squadra aggiunta: " . htmlspecialchars($team_name, ENT_QUOTES);
                        }
                    } catch (mysqli_sql_exception $e) {
                        // Mostra messaggio chiaro in caso di duplicato a livello globale
                        if (strpos($e->getMessage(), 'Duplicate entry') !== false) {
                            $_SESSION['error'] = "Impossibile aggiungere '" . htmlspecialchars($team_name, ENT_QUOTES) . "': nome già utilizzato. Rinominare la squadra o aggiornare lo schema per permettere nomi uguali in leghe diverse.";
                        } else {
                            $_SESSION['error'] = "Errore durante l'inserimento della squadra.";
                        }
                    }
                }
                // Ricarica la pagina per mostrare il messaggio
                header("Location: impostazioni.php?league_id=$league_id&section=teams");
                exit();
                break;

            case 'add_player':
                $first_name = $_POST['first_name'];
                $last_name = $_POST['last_name'];
                $team_id = $_POST['team_id'];
                $role = $_POST['role'];
                $rating = $_POST['rating'];
                
                $stmt = $conn->prepare("INSERT INTO players (first_name, last_name, team_id, role, rating) VALUES (?, ?, ?, ?, ?)");
                $stmt->bind_param("ssisd", $first_name, $last_name, $team_id, $role, $rating);
                $stmt->execute();
                break;

            case 'update_matchday':
                // Aggiorna o inserisce una nuova giornata
                $giornata = $_POST['giornata'];
                $deadline = $_POST['deadline_date'] . ' ' . $_POST['deadline_time'] . ':00';
                
                // Se la giornata è 0 (placeholder), significa che è una nuova giornata
                if ($giornata == '0') {
                    // Trova il numero di giornata più alto esistente e aggiungi 1
                    $stmt = $conn->prepare("SELECT MAX(giornata) FROM matchdays WHERE league_id = ?");
                    $stmt->bind_param("i", $league_id);
                    $stmt->execute();
                    $stmt->bind_result($max_giornata);
                    $stmt->fetch();
                    $stmt->close();
                    
                    $giornata = ($max_giornata ?? 0) + 1;
                }
                
                // Verifica se esiste già una giornata con lo stesso numero
                $stmt = $conn->prepare("SELECT COUNT(*) FROM matchdays WHERE league_id = ? AND giornata = ?");
                $stmt->bind_param("ii", $league_id, $giornata);
                $stmt->execute();
                $stmt->bind_result($count);
                $stmt->fetch();
                $stmt->close();
                
                if ($count > 0) {
                    // Aggiorna la giornata esistente
                    $stmt = $conn->prepare("UPDATE matchdays SET deadline = ? WHERE league_id = ? AND giornata = ?");
                    $stmt->bind_param("sii", $deadline, $league_id, $giornata);
                } else {
                    // Inserisce una nuova giornata
                    $stmt = $conn->prepare("INSERT INTO matchdays (league_id, giornata, deadline) VALUES (?, ?, ?)");
                    $stmt->bind_param("iis", $league_id, $giornata, $deadline);
                }
                
                $stmt->execute();
                
                // Riorganizza i numeri delle giornate per mantenere l'ordine cronologico
                // Usa un approccio a due fasi per evitare conflitti con il vincolo di unicità
                // Fase 1: Assegna numeri temporanei alti (1000+) per evitare conflitti
                $stmt = $conn->prepare("SET @temp_count = 1000");
                $stmt->execute();
                $stmt = $conn->prepare("UPDATE matchdays SET giornata = @temp_count:= @temp_count + 1 WHERE league_id = ? ORDER BY deadline ASC");
                $stmt->bind_param("i", $league_id);
                $stmt->execute();
                
                // Fase 2: Assegna i numeri finali corretti
                $stmt = $conn->prepare("SET @final_count = 0");
                $stmt->execute();
                $stmt = $conn->prepare("UPDATE matchdays SET giornata = @final_count:= @final_count + 1 WHERE league_id = ? ORDER BY deadline ASC");
                $stmt->bind_param("i", $league_id);
                $stmt->execute();
                
                header("Location: " . $_SERVER['PHP_SELF'] . "?league_id=" . $league_id . "&section=calendar");
                exit();

            case 'delete_matchday':
                // Elimina la giornata
                $stmt = $conn->prepare("DELETE FROM matchdays WHERE league_id = ? AND giornata = ?");
                $stmt->bind_param("ii", $league_id, $_POST['giornata']);
                $stmt->execute();
                
                // Riorganizza i numeri delle giornate SOLO dopo l'eliminazione
                // Usa un approccio a due fasi per evitare conflitti con il vincolo di unicità
                // Fase 1: Assegna numeri temporanei alti (1000+) per evitare conflitti
                $stmt = $conn->prepare("SET @temp_count = 1000");
                $stmt->execute();
                $stmt = $conn->prepare("UPDATE matchdays SET giornata = @temp_count:= @temp_count + 1 WHERE league_id = ? ORDER BY deadline ASC");
                $stmt->bind_param("i", $league_id);
                $stmt->execute();
                
                // Fase 2: Assegna i numeri finali corretti
                $stmt = $conn->prepare("SET @final_count = 0");
                $stmt->execute();
                $stmt = $conn->prepare("UPDATE matchdays SET giornata = @final_count:= @final_count + 1 WHERE league_id = ? ORDER BY deadline ASC");
                $stmt->bind_param("i", $league_id);
                $stmt->execute();
                
                header("Location: " . $_SERVER['PHP_SELF'] . "?league_id=" . $league_id . "&section=calendar");
                exit();

            case 'change_role':
                $memberId = $_POST['member_id'] ?? '';
                $newRole = $_POST['new_role'] ?? '';

                // Recupera l'user_id e ruolo attuale del membro
                $stmt = $conn->prepare("SELECT user_id, role FROM league_members WHERE id = ? AND league_id = ?");
                $stmt->bind_param("ii", $memberId, $league_id);
                $stmt->execute();
                $res = $stmt->get_result();
                $member = $res->fetch_assoc();

                if ($member) {
                    $isChangingAdmin = ($member['role'] === 'admin' && $newRole !== 'admin');
                    if ($isChangingAdmin) {
                        // Conta quanti admin ci sono nella lega
                        $stmt = $conn->prepare("SELECT COUNT(*) as admin_count FROM league_members WHERE league_id = ? AND role = 'admin'");
                        $stmt->bind_param("i", $league_id);
                        $stmt->execute();
                        $res = $stmt->get_result();
                        $row = $res->fetch_assoc();
                        if ($row && $row['admin_count'] <= 1) {
                            $_SESSION['error'] = 'Devi nominare almeno un altro admin prima di poter cambiare ruolo all\'ultimo admin della lega.';
                            header("Location: " . $_SERVER['PHP_SELF'] . "?league_id=" . $league_id . "&section=users");
                            exit();
                        }
                    }
                    if (in_array($newRole, ['admin', 'pagellatore', 'user'])) {
                        $stmt = $conn->prepare("UPDATE league_members SET role = ? WHERE id = ? AND league_id = ?");
                        $stmt->bind_param("sii", $newRole, $memberId, $league_id);

                        if ($stmt->execute()) {
                            $_SESSION['success'] = 'Ruolo aggiornato con successo!';
                        } else {
                            $_SESSION['error'] = 'Errore nell\'aggiornamento del ruolo.';
                        }
                    }
                }
                header("Location: " . $_SERVER['PHP_SELF'] . "?league_id=" . $league_id . "&section=users");
                exit();

                case 'remove_user':
                    $removeUserId = (int)$_POST['remove_user_id'];
                    if ($removeUserId !== $user_id) { // Non può rimuovere se stesso
                        // 1) league_members
                        $stmt = $conn->prepare("DELETE FROM league_members WHERE user_id = ? AND league_id = ?");
                        $stmt->bind_param("ii", $removeUserId, $league_id);
                        $stmt->execute();
                
                        // 2) user_players (tutti i giocatori nella lega)
                        $stmt = $conn->prepare("
                            DELETE up
                            FROM user_players up
                            JOIN players p ON up.player_id = p.id
                            JOIN teams t ON p.team_id = t.id
                            WHERE up.user_id = ? AND t.league_id = ?
                        ");
                        $stmt->bind_param("ii", $removeUserId, $league_id);
                        $stmt->execute();
                
                        // 3) user_budget
                        $stmt = $conn->prepare("DELETE FROM user_budget WHERE user_id = ? AND league_id = ?");
                        $stmt->bind_param("ii", $removeUserId, $league_id);
                        $stmt->execute();
                
                        // 4) user_lineups
                        $stmt = $conn->prepare("DELETE FROM user_lineups WHERE user_id = ? AND league_id = ?");
                        $stmt->bind_param("ii", $removeUserId, $league_id);
                        $stmt->execute();
                
                        // 5) league_join_requests
                        $stmt = $conn->prepare("DELETE FROM league_join_requests WHERE user_id = ? AND league_id = ?");
                        $stmt->bind_param("ii", $removeUserId, $league_id);
                        $stmt->execute();
                
                        // 6) user_league_prefs
                        $stmt = $conn->prepare("DELETE FROM user_league_prefs WHERE user_id = ? AND league_id = ?");
                        $stmt->bind_param("ii", $removeUserId, $league_id);
                        $stmt->execute();
                
                        // 7) user_market_blocks
                        $stmt = $conn->prepare("DELETE FROM user_market_blocks WHERE user_id = ? AND league_id = ?");
                        $stmt->bind_param("ii", $removeUserId, $league_id);
                        $stmt->execute();
                
                        $_SESSION['success'] = 'Utente rimosso dalla lega con tutti i dati.';
                    }
                    header("Location: " . $_SERVER['PHP_SELF'] . "?league_id=" . $league_id . "&section=users");
                    exit();
                
            case 'save_bonus_settings':
                $bonus_settings = [
                    'enable_bonus_malus' => isset($_POST['enable_bonus_malus']) ? 1 : 0,
                    'enable_goal' => isset($_POST['enable_goal']) ? 1 : 0,
                    'bonus_goal' => parse_decimal($_POST['bonus_goal'] ?? null, 3.0),
                    'enable_assist' => isset($_POST['enable_assist']) ? 1 : 0,
                    'bonus_assist' => parse_decimal($_POST['bonus_assist'] ?? null, 1.0),
                    'enable_yellow_card' => isset($_POST['enable_yellow_card']) ? 1 : 0,
                    'malus_yellow_card' => parse_decimal($_POST['malus_yellow_card'] ?? null, -0.5),
                    'enable_red_card' => isset($_POST['enable_red_card']) ? 1 : 0,
                    'malus_red_card' => parse_decimal($_POST['malus_red_card'] ?? null, -1.0),
                    'enable_goals_conceded' => isset($_POST['enable_goals_conceded']) ? 1 : 0,
                    'malus_goals_conceded' => parse_decimal($_POST['malus_goals_conceded'] ?? null, -1.0),
                    'enable_own_goal' => isset($_POST['enable_own_goal']) ? 1 : 0,
                    'malus_own_goal' => parse_decimal($_POST['malus_own_goal'] ?? null, -2.0),
                    'enable_penalty_missed' => isset($_POST['enable_penalty_missed']) ? 1 : 0,
                    'malus_penalty_missed' => parse_decimal($_POST['malus_penalty_missed'] ?? null, -3.0),
                    'enable_penalty_saved' => isset($_POST['enable_penalty_saved']) ? 1 : 0,
                    'bonus_penalty_saved' => parse_decimal($_POST['bonus_penalty_saved'] ?? null, 3.0),
                    'enable_clean_sheet' => isset($_POST['enable_clean_sheet']) ? 1 : 0,
                    'bonus_clean_sheet' => parse_decimal($_POST['bonus_clean_sheet'] ?? null, 1.0)
                ];
                $stmt = $conn->prepare("REPLACE INTO league_bonus_settings (league_id, enable_bonus_malus, enable_goal, bonus_goal, enable_assist, bonus_assist, enable_yellow_card, malus_yellow_card, enable_red_card, malus_red_card, enable_goals_conceded, malus_goals_conceded, enable_own_goal, malus_own_goal, enable_penalty_missed, malus_penalty_missed, enable_penalty_saved, bonus_penalty_saved, enable_clean_sheet, bonus_clean_sheet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $stmt->bind_param(
                    "iiididididididididid",
                    $league_id,
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
                $stmt->execute();
                echo '<div class="alert alert-success">Impostazioni bonus/malus salvate!</div>';
                break;
                
            case 'update_team_info':
                $team_name = trim($_POST['team_name']);
                $coach_name = trim($_POST['coach_name']);
                
                if (empty($team_name) || empty($coach_name)) {
                    $_SESSION['error'] = 'Nome squadra e nome allenatore sono obbligatori.';
                } else {
                    $result = updateTeamInfo($user_id, $league_id, $team_name, $coach_name);
                    if ($result === true) {
                        $_SESSION['success'] = 'Informazioni squadra aggiornate con successo.';
                        $currentUserTeamInfo['team_name'] = $team_name;
                        $currentUserTeamInfo['coach_name'] = $coach_name;
                    } elseif ($result === 'name_exists') {
                        $_SESSION['error'] = 'Nome squadra o nome allenatore già utilizzato in questa lega.';
                    } else {
                        $_SESSION['error'] = 'Errore nell\'aggiornamento delle informazioni.';
                    }
                }
                header("Location: " . $_SERVER['PHP_SELF'] . "?league_id=" . $league_id . "&section=team");
                exit();
                
            case 'approve_request':
                $requestId = (int)$_POST['request_id'];
                $result = approveJoinRequest($requestId);
                if ($result === true) {
                    $_SESSION['success'] = 'Richiesta di iscrizione approvata.';
                } elseif ($result === 'already_joined') {
                    $_SESSION['error'] = 'L\'utente è già iscritto alla lega.';
                } elseif ($result === 'name_exists') {
                    $_SESSION['error'] = 'Nome squadra o allenatore già utilizzato.';
                } else {
                    $_SESSION['error'] = 'Errore nell\'approvazione della richiesta.';
                }
                header("Location: " . $_SERVER['PHP_SELF'] . "?league_id=" . $league_id . "&section=users");
                exit();
                
            case 'reject_request':
                $requestId = (int)$_POST['request_id'];
                if (rejectJoinRequest($requestId)) {
                    $_SESSION['success'] = 'Richiesta di iscrizione rifiutata.';
                } else {
                    $_SESSION['error'] = 'Errore nel rifiuto della richiesta.';
                }
                header("Location: " . $_SERVER['PHP_SELF'] . "?league_id=" . $league_id . "&section=users");
                exit();
        }
    }
}

// Get teams
$stmt = $conn->prepare("SELECT * FROM teams WHERE league_id = ? ORDER BY name");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$teams = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Get players
$stmt = $conn->prepare("
    SELECT p.*, t.name as team_name 
    FROM players p 
    JOIN teams t ON p.team_id = t.id 
    WHERE t.league_id = ? 
    ORDER BY t.name, p.last_name, p.first_name
");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$players = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// Recupera le giornate dal database (solo se siamo nella sezione calendario)
$events = [];
if ($section === 'calendar') {
    $stmt = $conn->prepare("SELECT id, giornata, deadline FROM matchdays WHERE league_id = ? ORDER BY deadline ASC");
    $stmt->bind_param("i", $league_id);
    $stmt->execute();
    $result = $stmt->get_result();

    while ($row = $result->fetch_assoc()) {
        $deadline = new DateTime($row['deadline']);
        
        // Per gli utenti non admin, verifica se hanno già inviato la formazione
        $formation_status = '';
        if (!$is_admin && isset($_SESSION['user_id'])) {
            $stmt_formation = $conn->prepare("SELECT id FROM formation WHERE user_id = ? AND matchday_id = ?");
            $stmt_formation->bind_param("ii", $_SESSION['user_id'], $row['id']);
            $stmt_formation->execute();
            $has_formation = $stmt_formation->get_result()->num_rows > 0;
            $formation_status = $has_formation ? ' (Formazione inviata)' : ' (Formazione da inviare)';
        }
        
        $events[] = [
            'id' => $row['id'],
            'title' => 'Giornata ' . $row['giornata'] . $formation_status,
            'start' => $deadline->format('Y-m-d'),
            'allDay' => true,
            'backgroundColor' => $is_admin ? '#28a745' : ($has_formation ?? false ? '#28a745' : '#dc3545'),
            'borderColor' => $is_admin ? '#28a745' : ($has_formation ?? false ? '#28a745' : '#dc3545'),
            'textColor' => '#ffffff',
            'giornata' => $row['giornata'],
            'deadline_time' => $deadline->format('H:i')
        ];
    }
}

// Recupera i membri della lega (solo se siamo nella sezione users)
$members = [];
$activeCount = 0;
if ($section === 'users') {
    // Get league members
    $stmt = $conn->prepare("
        SELECT lm.*, u.username 
        FROM league_members lm 
        JOIN users u ON lm.user_id = u.id 
        WHERE lm.league_id = ?
        ORDER BY lm.role DESC, u.username ASC
    ");
    $stmt->bind_param("i", $league_id);
    $stmt->execute();
    $members = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    
    // Get join requests
    $joinRequests = getLeagueJoinRequests($league_id);
    
    // Get market settings
    $marketSettings = getLeagueMarketSettings($league_id);
    
    // Get user market blocks
    $userMarketBlocks = getUserMarketBlocks($league_id);
    
    // Get all league members with market block status
    $allLeagueMembers = getAllLeagueMembersWithMarketBlocks($league_id);

    // Calcolo partecipanti attivi (almeno un giocatore nella rosa per questa lega)
    $activeRes = $conn->query("
        SELECT COUNT(DISTINCT up.user_id) as attivi
        FROM user_players up
        JOIN players p ON up.player_id = p.id
        JOIN teams t ON p.team_id = t.id
        WHERE t.league_id = $league_id
    ");
    if ($row = $activeRes->fetch_assoc()) {
        $activeCount = $row['attivi'];
    }
}

// Recupera o imposta i bonus/malus della lega
$bonus_defaults = [
    'enable_bonus_malus' => 1,
    'enable_goal' => 1, 'bonus_goal' => 3.0,
    'enable_assist' => 1, 'bonus_assist' => 1.0,
    'enable_yellow_card' => 1, 'malus_yellow_card' => -0.5,
    'enable_red_card' => 1, 'malus_red_card' => -1.0
];
$bonus_settings = $bonus_defaults;
$stmt = $conn->prepare("SELECT * FROM league_bonus_settings WHERE league_id = ?");
$stmt->bind_param("i", $league_id);
$stmt->execute();
$res = $stmt->get_result();
if ($row = $res->fetch_assoc()) {
    $bonus_settings = array_merge($bonus_defaults, $row);
}

// --- IMPORT CSV LOGIC ---
$csvPreview = null;
$csvType = '';
$csvError = '';
if ($section === 'teams') {
    if (isset($_POST['import_csv']) && isset($_FILES['csv_file']) && $_FILES['csv_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['csv_file']['tmp_name'];
        $rows = [];
        $header = [];
        $type = '';
        $handle = fopen($file, 'r');
        if ($handle) {
            while (($data = fgetcsv($handle, 1000, ';')) !== false) {
                if (empty($header)) {
                    $header = $data;
                    continue;
                }
                if (count(array_filter($data, function ($v) { return trim($v) !== ''; })) === 0) continue; // skip empty
                $rows[] = $data;
            }
            fclose($handle);
        }
        // Riconoscimento tipo file
        if (count($header) === 1 && stripos($header[0], 'Squadra') !== false) {
            $type = 'squadre';
        } elseif (count($header) === 5 && stripos($header[2], 'Squadra') !== false && stripos($header[3], 'Ruolo') !== false) {
            $type = 'giocatori';
        } else {
            $csvError = 'Formato CSV non riconosciuto. Usa i template scaricabili.';
        }
        if (!$csvError) {
            $csvPreview = [
                'header' => $header,
                'rows' => $rows,
                'type' => $type
            ];
        }
    }
    if (isset($_POST['confirm_import_csv']) && isset($_POST['csv_type']) && isset($_POST['csv_data'])) {
        $type = $_POST['csv_type'];
        $rows = json_decode($_POST['csv_data'], true);
        $imported = 0;
        $skipped = 0;
        $errors = [];
        if ($type === 'squadre') {
            foreach ($rows as $row) {
                $teamName = trim($row[0] ?? '');
                if ($teamName === '') { $skipped++; continue; }
                // Check if team exists
                $stmt = $conn->prepare("SELECT id FROM teams WHERE league_id = ? AND name = ?");
                $stmt->bind_param("is", $league_id, $teamName);
                $stmt->execute();
                $res = $stmt->get_result();
                if ($res->fetch_assoc()) { $skipped++; $errors[] = "Squadra già esistente: $teamName"; continue; }
                $stmt = $conn->prepare("INSERT INTO teams (name, league_id) VALUES (?, ?)");
                $stmt->bind_param("si", $teamName, $league_id);
                if ($stmt->execute()) $imported++; else { $skipped++; $errors[] = "Errore su $teamName"; }
            }
        } elseif ($type === 'giocatori') {
            foreach ($rows as $row) {
                $first = trim($row[0] ?? '');
                $last = trim($row[1] ?? '');
                $teamName = trim($row[2] ?? '');
                $role = strtoupper(trim($row[3] ?? ''));
                $rating = str_replace(',', '.', trim($row[4] ?? ''));
                if ($first === '' || $last === '' || $teamName === '' || !in_array($role, ['P','D','C','A']) || !is_numeric($rating)) {
                    $skipped++; $errors[] = "Riga non valida: ".implode(';',$row); continue;
                }
                // Trova o crea squadra
                $stmt = $conn->prepare("SELECT id FROM teams WHERE league_id = ? AND name = ?");
                $stmt->bind_param("is", $league_id, $teamName);
                $stmt->execute();
                $res = $stmt->get_result();
                $team = $res->fetch_assoc();
                if (!$team) {
                    $stmt = $conn->prepare("INSERT INTO teams (name, league_id) VALUES (?, ?)");
                    $stmt->bind_param("si", $teamName, $league_id);
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
                if ($res->fetch_assoc()) { $skipped++; $errors[] = "Giocatore già esistente: $first $last ($teamName)"; continue; }
                $stmt = $conn->prepare("INSERT INTO players (first_name, last_name, team_id, role, rating) VALUES (?, ?, ?, ?, ?)");
                $stmt->bind_param("ssisd", $first, $last, $teamId, $role, $rating);
                if ($stmt->execute()) $imported++; else { $skipped++; $errors[] = "Errore su $first $last ($teamName)"; }
            }
        }
        $msg = "$imported importati, $skipped saltati.";
        if ($errors) $msg .= "<br>Dettagli:<br>".implode('<br>',$errors);
        $_SESSION['success'] = $msg;
        header("Location: impostazioni.php?league_id=$league_id&section=teams");
        exit();
    }
}
?>

<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Impostazioni - <?php echo htmlspecialchars($league['name']); ?></title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" rel="stylesheet">
    <?php if ($section === 'calendar'): ?>
    <link href="https://cdn.jsdelivr.net/npm/fullcalendar@5.11.3/main.min.css" rel="stylesheet">
    <?php endif; ?>
    <style>
        .page-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            margin-bottom: 2rem;
        }
        
        .settings-card {
            transition: transform 0.2s, box-shadow 0.2s;
            border: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 12px;
        }
        
        .settings-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        }
        
        .nav-tabs .nav-link {
            border: none;
            border-radius: 8px 8px 0 0;
            margin-right: 4px;
            color: #6c757d;
            font-weight: 500;
            transition: all 0.3s ease;
        }
        
        .nav-tabs .nav-link:hover {
            border-color: transparent;
            background-color: #f8f9fa;
            color: #495057;
        }
        
        .nav-tabs .nav-link.active {
            background-color: #0d6efd;
            color: white;
            border-color: transparent;
        }
        
        .badge-sezione { 
            background: #0d6efd; 
            font-size: 1em; 
            border-radius: 6px;
        }
        
        .badge-ruolo-P { background: #0d6efd; }
        .badge-ruolo-D { background: #198754; }
        .badge-ruolo-C { background: #ffc107; color: #212529; }
        .badge-ruolo-A { background: #dc3545; }
        
        .icon-sezione { 
            font-size: 1.2em; 
            vertical-align: middle; 
            margin-right: 2px; 
        }
        
        .badge-role-admin { background: #0d6efd; }
        .badge-role-pagellatore { background: #ffc107; color: #212529; }
        .badge-role-user { background: #198754; }
        
        .form-section {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        
        .form-section h5 {
            color: #2c3e50;
            font-weight: 600;
            margin-bottom: 1rem;
        }
        
        .btn-settings {
            border-radius: 8px;
            font-weight: 500;
            padding: 0.5rem 1.5rem;
            transition: all 0.3s ease;
        }
        
        .btn-settings:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        <?php if ($section === 'calendar'): ?>
        .card-calendar { 
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 12px;
        }
        .badge-giornata { 
            font-size: 1em; 
            background: #0d6efd; 
            border-radius: 6px;
        }
        .badge-deadline { 
            background: #ffc107; 
            color: #212529; 
            border-radius: 6px;
        }
        .fc .fc-toolbar-title { font-size: 1.3em; }
        .fc-event { font-size: 1em; }
        <?php endif; ?>
        
        @media (max-width: 575.98px) {
            h1, .card-header, .form-label, .btn, .form-control, .alert, .table th, .table td { 
                font-size: 1em !important; 
            }
            .btn, .btn-primary, .btn-outline-primary, .btn-sm { 
                font-size: 0.95em !important; 
                padding: 0.4em 0.7em; 
            }
            .form-control, .form-control-sm { 
                font-size: 0.95em !important; 
                padding: 0.4em 0.7em; 
            }
            .card, .card-sm { 
                margin-bottom: 1rem !important; 
            }
            .table th, .table td { 
                padding: 0.4em 0.3em !important; 
            }
            .nav-tabs .nav-link {
                font-size: 0.9em;
                padding: 0.5rem 0.75rem;
            }
        }
    </style>
    <?php if ($section === 'calendar'): ?>
    <script src="https://cdn.jsdelivr.net/npm/fullcalendar@5.11.3/main.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/fullcalendar@5.11.3/locales-all.min.js"></script>
    <?php endif; ?>
</head>
<body>
    <?php include 'navbar.php'; ?>
    
    <div class="page-header">
        <div class="container">
            <div class="row align-items-center">
                <div class="col">
                    <h1 class="mb-0">
                        <i class="bi bi-gear me-2"></i>
                        Impostazioni - <?php echo htmlspecialchars($league['name']); ?>
                    </h1>
                    <p class="mb-0 mt-2 opacity-75"><?php echo $is_admin ? 'Gestisci le impostazioni della lega' : 'Gestisci la tua squadra'; ?></p>
                </div>
            </div>
        </div>
    </div>
    
    <div class="container mt-4">
        
        <!-- Navigation Tabs -->
        <div class="row mb-4">
            <div class="col-12">
                <div class="card border-0 shadow-sm">
                    <div class="card-body p-0">
                        <ul class="nav nav-tabs nav-fill border-0" id="settingsTabs" role="tablist">
                            <?php if ($is_admin): ?>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link <?php echo $section === 'general' ? 'active' : ''; ?>" 
                                   href="?league_id=<?php echo $league_id; ?>&section=general" 
                                   role="tab">
                                    <i class="bi bi-sliders me-2"></i>
                                    <span class="d-none d-md-inline">Impostazioni Generali</span>
                                    <span class="d-md-none">Generali</span>
                                </a>
                            </li>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link <?php echo $section === 'teams' ? 'active' : ''; ?>" 
                                   href="?league_id=<?php echo $league_id; ?>&section=teams" 
                                   role="tab">
                                    <i class="bi bi-people me-2"></i>
                                    <span class="d-none d-md-inline">Gestione Squadre</span>
                                    <span class="d-md-none">Squadre</span>
                                </a>
                            </li>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link <?php echo $section === 'users' ? 'active' : ''; ?>" 
                                   href="?league_id=<?php echo $league_id; ?>&section=users" 
                                   role="tab">
                                    <i class="bi bi-person-gear me-2"></i>
                                    <span class="d-none d-md-inline">Gestione Utenti</span>
                                    <span class="d-md-none">Utenti</span>
                                </a>
                            </li>
                            <?php endif; ?>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link <?php echo $section === 'team' ? 'active' : ''; ?>" 
                                   href="?league_id=<?php echo $league_id; ?>&section=team" 
                                   role="tab">
                                    <i class="bi bi-shield-check me-2"></i>
                                    <span class="d-none d-md-inline">La mia Squadra</span>
                                    <span class="d-md-none">Squadra</span>
                                </a>
                            </li>
                            <?php if ($is_admin): ?>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link <?php echo $section === 'calendar' ? 'active' : ''; ?>" 
                                   href="?league_id=<?php echo $league_id; ?>&section=calendar" 
                                   role="tab">
                                    <i class="bi bi-calendar-event me-2"></i>
                                    <span class="d-none d-md-inline">Gestione Calendario</span>
                                    <span class="d-md-none">Calendario</span>
                                </a>
                            </li>
                            <li class="nav-item" role="presentation">
                                <a class="nav-link <?php echo $section === 'calculate' ? 'active' : ''; ?>" 
                                   href="?league_id=<?php echo $league_id; ?>&section=calculate" 
                                   role="tab">
                                    <i class="bi bi-calculator me-2"></i>
                                    <span class="d-none d-md-inline">Calcola Giornata</span>
                                    <span class="d-md-none">Calcola</span>
                                </a>
                            </li>
                            <?php endif; ?>
                        </ul>
                    </div>
                </div>
            </div>
        </div>

        <?php if (isset($_SESSION['error'])): ?>
            <div class="alert alert-danger alert-dismissible fade show" role="alert">
                <i class="bi bi-exclamation-triangle"></i> <?php echo htmlspecialchars($_SESSION['error']); ?>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
            </div>
            <?php unset($_SESSION['error']); ?>
        <?php endif; ?>
        
        <?php if (isset($_SESSION['success'])): ?>
            <div class="alert alert-success alert-dismissible fade show" role="alert">
                <i class="bi bi-check-circle"></i> <?php echo htmlspecialchars($_SESSION['success']); ?>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
            </div>
            <?php unset($_SESSION['success']); ?>
        <?php endif; ?>

        <?php if ($section === 'general'): ?>
        <!-- Impostazioni Generali -->
        <div class="row">
            <div class="col-md-8 mx-auto">
                <div class="card settings-card">
                    <div class="card-header bg-primary text-white d-flex align-items-center">
                        <i class="bi bi-sliders me-2"></i>
                        <h5 class="mb-0">Impostazioni Generali</h5>
                    </div>
                    <div class="card-body">
                        <form method="POST">
                            <input type="hidden" name="action" value="update_default_time">
                            <div class="mb-3">
                                <label for="default_time" class="form-label">Orario di default per le scadenze</label>
                                <input type="time" class="form-control" id="default_time" name="default_time" 
                                       value="<?php echo $league['default_deadline_time'] ?? '20:00'; ?>" required>
                            </div>
                            <div class="mb-3">
                                <label for="access_code" class="form-label">Codice di Accesso (lascia vuoto per nessun codice)</label>
                                <input type="text" class="form-control" id="access_code" name="access_code" value="<?php echo htmlspecialchars($league['access_code'] ?? ''); ?>" maxlength="20">
                                <div class="form-text">Se vuoi togliere il codice, lascia il campo vuoto e salva.</div>
                            </div>
                            <div class="mb-3">
                                <label for="numero_titolari" class="form-label">Numero giocatori titolari in campo</label>
                                <input type="number" class="form-control" id="numero_titolari" name="numero_titolari" min="4" max="11" value="<?php echo isset($league['numero_titolari']) ? (int)$league['numero_titolari'] : 11; ?>" required>
                                <div class="form-text">Scegli quanti giocatori schierare in campo (default 11).</div>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Limite giocatori per ruolo</label>
                                <div class="row g-2">
                                    <div class="col-6">
                                        <label for="max_portieri" class="form-label"><span class="badge badge-ruolo-P"><i class="bi bi-shield-lock"></i> Portieri</span></label>
                                        <input type="number" class="form-control" id="max_portieri" name="max_portieri" min="1" max="10" value="<?php echo (int)$league['max_portieri']; ?>" required>
                                    </div>
                                    <div class="col-6">
                                        <label for="max_difensori" class="form-label"><span class="badge badge-ruolo-D"><i class="bi bi-shield"></i> Difensori</span></label>
                                        <input type="number" class="form-control" id="max_difensori" name="max_difensori" min="1" max="20" value="<?php echo (int)$league['max_difensori']; ?>" required>
                                    </div>
                                    <div class="col-6">
                                        <label for="max_centrocampisti" class="form-label"><span class="badge badge-ruolo-C"><i class="bi bi-lightning-charge"></i> Centrocampisti</span></label>
                                        <input type="number" class="form-control" id="max_centrocampisti" name="max_centrocampisti" min="1" max="20" value="<?php echo (int)$league['max_centrocampisti']; ?>" required>
                                    </div>
                                    <div class="col-6">
                                        <label for="max_attaccanti" class="form-label"><span class="badge badge-ruolo-A"><i class="bi bi-fire"></i> Attaccanti</span></label>
                                        <input type="number" class="form-control" id="max_attaccanti" name="max_attaccanti" min="1" max="10" value="<?php echo (int)$league['max_attaccanti']; ?>" required>
                                    </div>
                                </div>
                            </div>
                            <button type="submit" class="btn btn-primary btn-settings"><i class="bi bi-save"></i> Salva Impostazioni</button>
                        </form>
                    </div>
                </div>
                <!-- Sezione Bonus/Malus -->
                <div class="card settings-card mb-4 mt-4">
                    <div class="card-header bg-info text-dark d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center">
                            <i class="bi bi-emoji-smile me-2"></i>
                            <h5 class="mb-0">Bonus/Malus Lega</h5>
                        </div>
                        <form method="POST" class="m-0 p-0 d-flex align-items-center">
                            <input type="hidden" name="action" value="save_bonus_settings">
                            <input type="hidden" name="save_bonus_settings" value="1">
                            <div class="form-check form-switch m-0">
                                <input class="form-check-input" type="checkbox" id="enable_bonus_malus" name="enable_bonus_malus" <?php if($bonus_settings['enable_bonus_malus']) echo 'checked'; ?>>
                                <label class="form-check-label ms-2" for="enable_bonus_malus"></label>
                            </div>
                    </div>
                    <div class="card-body">
    <div id="bonusMalusSettings" <?php if(!$bonus_settings['enable_bonus_malus']) echo 'style="display:none;"'; ?>>
        <div class="row g-2 align-items-center mb-2">
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_goal" name="enable_goal" <?php if($bonus_settings['enable_goal']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_goal">Abilita Goal ⚽</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="bonus_goal" id="bonus_goal" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['bonus_goal']); ?>">
                <label for="bonus_goal" class="form-label">Bonus Goal</label>
            </div>
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_assist" name="enable_assist" <?php if($bonus_settings['enable_assist']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_assist">Abilita Assist 🥾</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="bonus_assist" id="bonus_assist" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['bonus_assist']); ?>">
                <label for="bonus_assist" class="form-label">Bonus Assist</label>
            </div>
        </div>
        <div class="row g-2 align-items-center mb-2">
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_yellow_card" name="enable_yellow_card" <?php if($bonus_settings['enable_yellow_card']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_yellow_card">Abilita Giallo 🟨</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="malus_yellow_card" id="malus_yellow_card" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['malus_yellow_card']); ?>">
                <label for="malus_yellow_card" class="form-label">Malus Giallo</label>
            </div>
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_red_card" name="enable_red_card" <?php if($bonus_settings['enable_red_card']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_red_card">Abilita Rosso 🟥</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="malus_red_card" id="malus_red_card" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['malus_red_card']); ?>">
                <label for="malus_red_card" class="form-label">Malus Rosso</label>
            </div>
        </div>
        <div class="row g-2 align-items-center mb-2">
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_goals_conceded" name="enable_goals_conceded" <?php if($bonus_settings['enable_goals_conceded']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_goals_conceded">Goal Subito 🥅</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="malus_goals_conceded" id="malus_goals_conceded" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['malus_goals_conceded']); ?>">
                <label for="malus_goals_conceded" class="form-label">Malus Goal Subito</label>
            </div>
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_own_goal" name="enable_own_goal" <?php if($bonus_settings['enable_own_goal']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_own_goal">Autogoal ⚠️</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="malus_own_goal" id="malus_own_goal" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['malus_own_goal']); ?>">
                <label for="malus_own_goal" class="form-label">Malus Autogoal</label>
            </div>
        </div>
        <div class="row g-2 align-items-center mb-2">
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_penalty_missed" name="enable_penalty_missed" <?php if($bonus_settings['enable_penalty_missed']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_penalty_missed">Rig. Sbagliato ❌</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="malus_penalty_missed" id="malus_penalty_missed" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['malus_penalty_missed']); ?>">
                <label for="malus_penalty_missed" class="form-label">Malus Rig. Sbagliato</label>
            </div>
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_penalty_saved" name="enable_penalty_saved" <?php if($bonus_settings['enable_penalty_saved']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_penalty_saved">Rig. Parato 🧤</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="bonus_penalty_saved" id="bonus_penalty_saved" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['bonus_penalty_saved']); ?>">
                <label for="bonus_penalty_saved" class="form-label">Bonus Rig. Parato</label>
            </div>
        </div>
        <div class="row g-2 align-items-center mb-2">
            <div class="col-6 col-md-3">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="enable_clean_sheet" name="enable_clean_sheet" <?php if($bonus_settings['enable_clean_sheet']) echo 'checked'; ?>>
                    <label class="form-check-label" for="enable_clean_sheet">Clean Sheet 🔒</label>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <input type="number" step="0.5" class="form-control" name="bonus_clean_sheet" id="bonus_clean_sheet" 
                       value="<?php echo str_replace(',', '.', (string)$bonus_settings['bonus_clean_sheet']); ?>">
                <label for="bonus_clean_sheet" class="form-label">Bonus Clean Sheet</label>
            </div>
        </div>
    </div>
    <div class="text-end mt-3">
        <button type="submit" class="btn btn-info btn-settings"><i class="bi bi-save"></i> Salva Bonus/Malus</button>
    </div>
</div>

                        </form>
                    </div>
                </div>
                <script>
                document.getElementById('enable_bonus_malus').addEventListener('change', function() {
                    document.getElementById('bonusMalusSettings').style.display = this.checked ? '' : 'none';
                });
                </script>
                <script>
                document.querySelectorAll('form').forEach(function(form) {
                  form.addEventListener('submit', function(e) {
                    this.querySelectorAll('input[type=number][step="0.1"]').forEach(function(input) {
                      if (input.value.includes(',')) {
                        input.value = input.value.replace(',', '.');
                      }
                    });
                  });
                });
                </script>
            </div>
        </div>

        <?php elseif ($section === 'teams'): ?>
        <div class="d-flex justify-content-end mb-2">
          <a href="admin_panel.php?league_id=<?php echo $league_id; ?>" class="btn btn-warning btn-sm">
            <i class="bi bi-tools"></i> Vai all'Admin Panel
          </a>
        </div>
        <!-- Importa/Esporta CSV Section (compatta, sopra le card) -->
        <div class="card settings-card mb-3" style="padding:0.5rem 1rem;">
            <div class="card-header bg-info text-white py-2 px-3 d-flex align-items-center justify-content-between" style="font-size:1rem;">
                <div><i class="bi bi-upload me-2"></i><span>Importa/Esporta CSV</span></div>
                <button type="button" class="btn btn-outline-light btn-sm" data-bs-toggle="modal" data-bs-target="#csvHelpModal">
                    <i class="bi bi-info-circle"></i> Guida importazione CSV
                </button>
            </div>
            <div class="card-body py-2 px-3">
                <div class="mb-2">
                    <a href="template_squadre.csv" class="btn btn-outline-primary btn-sm me-2"><i class="bi bi-download"></i> Template Squadre</a>
                    <a href="template_giocatori.csv" class="btn btn-outline-success btn-sm me-2"><i class="bi bi-download"></i> Template Giocatori</a>
                    <a href="export_teams.php?league_id=<?php echo $league_id; ?>" class="btn btn-primary btn-sm me-2"><i class="bi bi-filetype-csv"></i> Scarica Squadre della Lega</a>
                    <a href="export_players.php?league_id=<?php echo $league_id; ?>" class="btn btn-success btn-sm"><i class="bi bi-filetype-csv"></i> Scarica Giocatori della Lega</a>
                </div>
                <?php if (isset($csvError) && $csvError): ?>
                    <div class="alert alert-danger alert-sm py-1 my-2 d-flex align-items-center" style="font-size:0.95em;"><i class="bi bi-exclamation-triangle-fill me-2"></i> <?php echo $csvError; ?></div>
                <?php endif; ?>
                <?php if (isset($csvPreview) && $csvPreview): ?>
                    <div class="alert alert-info"><i class="bi bi-eye"></i> Anteprima dati da importare (<?php echo $csvPreview['type'] === 'squadre' ? 'Squadre' : 'Giocatori'; ?>):</div>
                    <form method="POST" enctype="multipart/form-data">
                        <input type="hidden" name="csv_type" value="<?php echo htmlspecialchars($csvPreview['type']); ?>">
                        <input type="hidden" name="csv_data" value='<?php echo json_encode($csvPreview['rows']); ?>'>
                        <div class="table-responsive mb-3">
                            <table class="table table-bordered table-sm align-middle">
                                <thead class="table-light">
                                    <tr>
                                        <?php foreach ($csvPreview['header'] as $h): ?><th><?php echo htmlspecialchars($h); ?></th><?php endforeach; ?>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($csvPreview['rows'] as $row): ?>
                                        <tr>
                                            <?php foreach ($row as $cell): ?><td><?php echo htmlspecialchars($cell); ?></td><?php endforeach; ?>
                                        </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                        <button type="submit" name="confirm_import_csv" class="btn btn-success"><i class="bi bi-check-circle"></i> Conferma importazione</button>
                        <a href="impostazioni.php?league_id=<?php echo $league_id; ?>&section=teams" class="btn btn-secondary ms-2"><i class="bi bi-x-circle"></i> Annulla</a>
                    </form>
                <?php else: ?>
                <form method="POST" enctype="multipart/form-data" class="mb-0">
                    <div class="row g-2 align-items-end">
                        <div class="col-md-8">
                            <label for="csv_file" class="form-label mb-1" style="font-size:0.95em;">File CSV</label>
                            <input type="file" class="form-control form-control-sm" id="csv_file" name="csv_file" accept=".csv" required>
                        </div>
                        <div class="col-md-4">
                            <button type="submit" name="import_csv" class="btn btn-primary btn-sm w-100"><i class="bi bi-upload"></i> Importa</button>
                        </div>
                    </div>
                    <div class="form-text mt-1" style="font-size:0.95em;">Carica un file CSV di squadre o giocatori. Il tipo verrà riconosciuto automaticamente.</div>
                </form>
                <?php endif; ?>
            </div>
        </div>
        <!-- Modal Guida CSV -->
        <div class="modal fade" id="csvHelpModal" tabindex="-1" aria-labelledby="csvHelpModalLabel" aria-hidden="true">
          <div class="modal-dialog modal-lg modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header bg-info text-white">
                <h5 class="modal-title" id="csvHelpModalLabel"><i class="bi bi-info-circle"></i> Guida importazione CSV</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Chiudi"></button>
              </div>
              <div class="modal-body" style="font-size:1.05em;">
                <b>Attenzione:</b> alcune righe del file CSV potrebbero essere ignorate se:
                <ul>
                  <li>Una o più colonne sono vuote (es: manca nome, cognome, squadra, ruolo o valutazione)</li>
                  <li>L'ordine o il numero delle colonne non rispetta il template</li>
                  <li>Per i giocatori: la valutazione non è numerica o il ruolo non è tra <b>P</b>, <b>D</b>, <b>C</b>, <b>A</b></li>
                </ul>
                <b>Correzione consigliata:</b> controlla che ogni colonna sia compilata, senza colonne extra o vuote.<br>
                <b>Esempio valido:</b> <code>Gianluigi;Buffon;Juventus;P;9.5</code><br>
                <b>Esempio ignorato:</b> <code>Gianluigi;Buffon;Juventus;P;</code>
                <hr>
                <b>Note:</b>
                <ul>
                  <li>Il separatore deve essere <b>;</b> (punto e virgola), come nei template scaricabili.</li>
                  <li>Per i giocatori, se la squadra non esiste viene creata automaticamente.</li>
                  <li>Il tipo di file (squadre o giocatori) viene riconosciuto dal sistema.</li>
                </ul>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Chiudi</button>
              </div>
            </div>
          </div>
        </div>
        <!-- Gestione Squadre e Giocatori -->
        <div class="row">
            <!-- Gestione Squadre -->
            <div class="col-md-4">
                <div class="card settings-card mb-4">
                    <div class="card-header bg-success text-white d-flex align-items-center">
                        <i class="bi bi-people me-2"></i>
                        <h5 class="mb-0">Gestione Squadre</h5>
                    </div>
                    <div class="card-body">
                        <form method="POST" class="mb-3">
                            <input type="hidden" name="action" value="add_team">
                            <div class="mb-3">
                                <label for="team_name" class="form-label">Nome Squadra</label>
                                <input type="text" class="form-control" id="team_name" name="team_name" required>
                            </div>
                            <button type="submit" class="btn btn-success"><i class="bi bi-plus"></i> Aggiungi Squadra</button>
                        </form>
                        <div class="list-group">
                            <?php foreach ($teams as $team): ?>
                            <div class="list-group-item d-flex justify-content-between align-items-center">
                                <?php echo htmlspecialchars($team['name']); ?>
                                <span class="badge bg-primary rounded-pill">
                                    <?php 
                                    $player_count = array_filter($players, function($p) use ($team) {
                                        return $p['team_id'] == $team['id'];
                                    });
                                    echo count($player_count);
                                    ?> giocatori
                                </span>
                            </div>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </div>
            </div>
            <!-- Gestione Giocatori -->
            <div class="col-md-4">
                <div class="card settings-card mb-4">
                    <div class="card-header bg-warning text-dark d-flex align-items-center">
                        <i class="bi bi-person-plus me-2"></i>
                        <h5 class="mb-0">Gestione Giocatori</h5>
                    </div>
                    <div class="card-body">
                        <form method="POST">
                            <input type="hidden" name="action" value="add_player">
                            <div class="mb-3">
                                <label for="first_name" class="form-label">Nome</label>
                                <input type="text" class="form-control" id="first_name" name="first_name" required>
                            </div>
                            <div class="mb-3">
                                <label for="last_name" class="form-label">Cognome</label>
                                <input type="text" class="form-control" id="last_name" name="last_name" required>
                            </div>
                            <div class="mb-3">
                                <label for="team_id" class="form-label">Squadra</label>
                                <select class="form-select" id="team_id" name="team_id" required>
                                    <?php foreach ($teams as $team): ?>
                                    <option value="<?php echo $team['id']; ?>">
                                        <?php echo htmlspecialchars($team['name']); ?>
                                    </option>
                                    <?php endforeach; ?>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label for="role" class="form-label">Ruolo</label>
                                <select class="form-select" id="role" name="role" required>
                                    <option value="P">Portiere</option>
                                    <option value="D">Difensore</option>
                                    <option value="C">Centrocampista</option>
                                    <option value="A">Attaccante</option>
                                </select>
                            </div>
                            <div class="mb-3">
                                <label for="rating" class="form-label">Valutazione</label>
                                <input type="number" class="form-control" id="rating" name="rating" 
                                       min="0" max="10" step="0.1" required>
                            </div>
                            <button type="submit" class="btn btn-warning"><i class="bi bi-person-plus"></i> Aggiungi Giocatore</button>
                        </form>
                    </div>
                </div>
            </div>
        <!-- Lista Giocatori -->
            <div class="col-md-4">
                <div class="card settings-card mb-4">
                    <div class="card-header bg-info text-white d-flex align-items-center">
                        <i class="bi bi-list-ul me-2"></i>
                <h5 class="mb-0">Lista Giocatori</h5>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                            <table class="table table-striped table-sm">
                        <thead>
                            <tr>
                                <th>Squadra</th>
                                <th>Nome</th>
                                <th>Ruolo</th>
                                        <th>Val.</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($players as $player): ?>
                            <tr>
                                        <td><small><?php echo htmlspecialchars($player['team_name']); ?></small></td>
                                        <td><small><?php echo htmlspecialchars($player['first_name'] . ' ' . $player['last_name']); ?></small></td>
                                <td>
                                    <?php
                                    $ruoli = [
                                                'P' => 'P',
                                                'D' => 'D',
                                                'C' => 'C',
                                                'A' => 'A'
                                            ];
                                            echo '<span class="badge badge-ruolo-' . $player['role'] . '">' . $ruoli[$player['role']] . '</span>';
                                    ?>
                                </td>
                                        <td><small><?php echo number_format($player['rating'], 1); ?></small></td>
                                    </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <?php elseif ($section === 'users'): ?>
        <!-- Gestione Utenti -->
        <div class="row mb-4">
            <div class="col-lg-8 mx-auto">
                <div id="adminRoleAlert"></div>
                <div class="card settings-card mb-4">
                    <div class="card-header bg-success text-white d-flex align-items-center">
                        <i class="bi bi-people icon-league me-2"></i>
                        <h5 class="mb-0">Gestione Utenti</h5>
                    </div>
                    <div class="card-body">
                        <!-- Approval Requests Section -->
                        <?php if (!empty($joinRequests)): ?>
                        <div class="mb-4">
                            <h6 class="text-primary mb-3">
                                <i class="bi bi-hourglass-split me-2"></i>
                                Richieste di Iscrizione in Attesa
                            </h6>
                            <div class="row g-3">
                                <?php foreach ($joinRequests as $request): ?>
                                <div class="col-md-6">
                                    <div class="card border-warning">
                                        <div class="card-body">
                                            <h6 class="card-title"><?php echo htmlspecialchars($request['username']); ?></h6>
                                            <p class="card-text mb-2">
                                                <strong>Squadra:</strong> <?php echo htmlspecialchars($request['team_name']); ?><br>
                                                <strong>Allenatore:</strong> <?php echo htmlspecialchars($request['coach_name']); ?><br>
                                                <small class="text-muted">
                                                    <i class="bi bi-clock me-1"></i>
                                                    <?php echo date('d/m/Y H:i', strtotime($request['requested_at'])); ?>
                                                </small>
                                            </p>
                                            <div class="btn-group w-100">
                                                <form method="POST" class="d-inline">
                                                    <input type="hidden" name="action" value="approve_request">
                                                    <input type="hidden" name="request_id" value="<?php echo $request['id']; ?>">
                                                    <button type="submit" class="btn btn-success btn-sm">
                                                        <i class="bi bi-check-circle me-1"></i> Approva
                                                    </button>
                                                </form>
                                                <form method="POST" class="d-inline">
                                                    <input type="hidden" name="action" value="reject_request">
                                                    <input type="hidden" name="request_id" value="<?php echo $request['id']; ?>">
                                                    <button type="submit" class="btn btn-danger btn-sm">
                                                        <i class="bi bi-x-circle me-1"></i> Rifiuta
                                                    </button>
                                                </form>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <?php endforeach; ?>
                            </div>
                        </div>
                        <hr>
                        <?php endif; ?>
                        
                        <!-- Market Management Section -->
                        <div class="mb-4">
                            <h6 class="text-primary mb-3">
                                <i class="bi bi-shop me-2"></i>
                                Gestione Mercato
                            </h6>
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="card">
                                        <div class="card-body">
                                            <h6 class="card-title">Impostazioni Globali</h6>
                                            <div class="form-check form-switch mb-2">
                                                <input class="form-check-input" type="checkbox" id="market_locked" 
                                                       <?php echo ($marketSettings['market_locked'] ?? 0) ? 'checked' : ''; ?>>
                                                <label class="form-check-label" for="market_locked">
                                                    Mercato Bloccato
                                                </label>
                                            </div>
                                            <div class="form-check form-switch">
                                                <input class="form-check-input" type="checkbox" id="require_approval" 
                                                       <?php echo ($marketSettings['require_approval'] ?? 0) ? 'checked' : ''; ?>>
                                                <label class="form-check-label" for="require_approval">
                                                    Richiedi Approvazione Iscrizioni
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="card">
                                        <div class="card-body">
                                            <h6 class="card-title">
                                                Permessi Mercato
                                                <i class="bi bi-info-circle text-info ms-2" 
                                                   data-bs-toggle="tooltip" 
                                                   data-bs-placement="top" 
                                                   title="Gestione mercato: 2 modalità di gestione, se il mercato è attivo è possibile bloccare a singoli utenti il mercato, se il mercato è bloccato è possibile sbloccarlo a signoli utenti"></i>
                                            </h6>
                                            <div class="alert alert-info alert-sm mb-3">
                                                <small>
                                                    <strong>Stato attuale:</strong> 
                                                    <span class="badge <?php echo ($marketSettings['market_locked'] ?? 0) ? 'bg-danger' : 'bg-success'; ?>">
                                                        <?php echo ($marketSettings['market_locked'] ?? 0) ? 'Mercato Bloccato' : 'Mercato Attivo'; ?>
                                                    </span>
                                                    </small>
                                            </div>
                                            
                                            <!-- User list -->
                                            <div class="list-group list-group-flush" id="userList" style="max-height: 300px; overflow-y: auto;">
                                                <?php foreach ($allLeagueMembers as $member): ?>
                                                <div class="list-group-item d-flex justify-content-between align-items-center px-0 user-item" 
                                                     data-team-name="<?php echo strtolower(htmlspecialchars($member['team_name'] ?? '')); ?>"
                                                     data-coach-name="<?php echo strtolower(htmlspecialchars($member['coach_name'] ?? '')); ?>"
                                                     data-username="<?php echo strtolower(htmlspecialchars($member['username'])); ?>"
                                                     data-blocked="<?php echo $member['blocked']; ?>">
                                                    <div>
                                                        <strong><?php echo htmlspecialchars($member['username']); ?></strong><br>
                                                        <small class="text-muted">
                                                            <?php echo htmlspecialchars($member['team_name'] ?? 'Senza squadra'); ?> - 
                                                            <?php echo htmlspecialchars($member['coach_name'] ?? 'Senza allenatore'); ?>
                                                        </small>
                                                    </div>
                                                    <div class="form-check form-switch">
                                                        <input class="form-check-input" type="checkbox" 
                                                               data-user-id="<?php echo $member['user_id']; ?>"
                                                               <?php echo $member['blocked'] ? 'checked' : ''; ?>>
                                                    </div>
                                                </div>
                                                <?php endforeach; ?>
                                            </div>
                                            
                                            <?php if (empty($allLeagueMembers)): ?>
                                                <p class="text-muted mb-0">Nessun utente nella lega.</p>
                                            <?php endif; ?>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <hr>
                        
                        <!-- Users Management Section -->
                        <h6 class="text-primary mb-3">
                            <i class="bi bi-people me-2"></i>
                            Gestione Utenti
                        </h6>
                        <div class="table-responsive">
                            <table class="table align-middle">
                                <thead class="table-light">
                                    <tr>
                                        <th>Username</th>
                                        <th>Ruolo</th>
                                        <th>Azioni</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php
                                    $stmt = $conn->prepare("SELECT lm.*, u.username FROM league_members lm JOIN users u ON lm.user_id = u.id WHERE lm.league_id = ? ORDER BY lm.role DESC, u.username ASC");
                                    $stmt->bind_param("i", $league_id);
                                    $stmt->execute();
                                    $members = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
                                    foreach ($members as $member): ?>
                                        <tr>
                                            <td><?php echo htmlspecialchars($member['username']); ?></td>
                                            <td>
                                                <?php if ($member['role'] === 'admin'): ?>
                                                    <span class="badge badge-role-admin"><i class="bi bi-star-fill"></i> Admin</span>
                                                <?php elseif ($member['role'] === 'pagellatore'): ?>
                                                    <span class="badge badge-role-pagellatore"><i class="bi bi-pencil"></i> Pagellatore</span>
                                                <?php else: ?>
                                                    <span class="badge badge-role-user"><i class="bi bi-person"></i> Utente</span>
                                                <?php endif; ?>
                                            </td>
                                            <td>
                                                <form method="POST" class="d-inline">
                                                    <input type="hidden" name="action" value="change_role">
                                                    <input type="hidden" name="member_id" value="<?php echo $member['id']; ?>">
                                                    <select name="new_role" class="form-select form-select-sm d-inline-block w-auto role-select" data-member-id="<?php echo $member['id']; ?>" data-user-id="<?php echo $member['user_id']; ?>">
                                                        <option value="user" <?php echo $member['role'] === 'user' ? 'selected' : ''; ?>>Utente</option>
                                                        <option value="pagellatore" <?php echo $member['role'] === 'pagellatore' ? 'selected' : ''; ?>>Pagellatore</option>
                                                        <option value="admin" <?php echo $member['role'] === 'admin' ? 'selected' : ''; ?>>Admin</option>
                                                    </select>
                                                </form>
                                                <?php if ($member['user_id'] == $user_id): ?>
                                                    <button type="button" class="btn btn-sm btn-outline-danger ms-2 leave-league-btn">
                                                        <i class="bi bi-box-arrow-left"></i> Abbandona lega
                                                    </button>
                                                <?php else: ?>
                                                    <button type="button" class="btn btn-sm btn-danger ms-2 remove-user-btn"
                                                            data-user-id="<?php echo $member['user_id']; ?>"
                                                            data-username="<?php echo htmlspecialchars($member['username']); ?>">
                                                        <i class="bi bi-person-x"></i> Rimuovi
                                                    </button>
                                                <?php endif; ?>
                                            </td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
            </div>
        </div>

        <?php elseif ($section === 'team'): ?>
        <!-- La mia Squadra -->
        <div class="row">
            <div class="col-lg-8 mx-auto">
                <div class="card">
                    <div class="card-header bg-primary text-white">
                        <h5 class="mb-0">
                            <i class="bi bi-shield-check me-2"></i>
                            Modifica Informazioni Squadra
                        </h5>
                    </div>
                    <div class="card-body">
                        <?php if (isset($_SESSION['success'])): ?>
                            <div class="alert alert-success"><?php echo $_SESSION['success']; unset($_SESSION['success']); ?></div>
                        <?php endif; ?>
                        <?php if (isset($_SESSION['error'])): ?>
                            <div class="alert alert-danger"><?php echo $_SESSION['error']; unset($_SESSION['error']); ?></div>
                        <?php endif; ?>
                        
                        <!-- Logo Squadra -->
                        <div class="text-center mb-4">
                            <div class="position-relative d-inline-block" style="margin-bottom: 1rem;">
                                <?php
                                $currentLogo = $currentUserTeamInfo['team_logo'] ?? 'default_1';
                                $isDefaultLogo = strpos($currentLogo, 'default_') === 0;
                                
                                // Loghi di default (stesso array dell'app)
                                $defaultLogos = [
                                    'default_1' => ['emoji' => '⚽', 'color' => '#4CAF50'],
                                    'default_2' => ['emoji' => '⚔️', 'color' => '#F44336'],
                                    'default_3' => ['emoji' => '🛡️', 'color' => '#2196F3'],
                                    'default_4' => ['emoji' => '🏴‍☠️', 'color' => '#CCAAEE'],
                                    'default_5' => ['emoji' => '🐺', 'color' => '#9C27B0'],
                                    'default_6' => ['emoji' => '🐍', 'color' => '#1976D2'],
                                    'default_7' => ['emoji' => '🦁', 'color' => '#FF9800'],
                                    'default_8' => ['emoji' => '🦉', 'color' => '#E91E63'],
                                    'default_9' => ['emoji' => '🔰', 'color' => '#FFD700'],
                                    'default_10' => ['emoji' => '💣', 'color' => '#8D6E63'],
                                    'default_11' => ['emoji' => '💎', 'color' => '#8B4513'],
                                    'default_12' => ['emoji' => '🛸', 'color' => '#607D8B'],
                                ];
                                ?>
                                <div id="currentLogo" style="width: 120px; height: 120px; border-radius: 60px; border: 3px solid #667eea; display: inline-flex; align-items: center; justify-content: center; background-color: <?php echo ($isDefaultLogo && isset($defaultLogos[$currentLogo])) ? ($defaultLogos[$currentLogo]['color'] . '30') : '#f0f0f0'; ?>; font-size: 64px; position: relative;">
                                    <?php if ($isDefaultLogo && isset($defaultLogos[$currentLogo])): ?>
                                        <?php echo $defaultLogos[$currentLogo]['emoji']; ?>
                                    <?php else: ?>
                                        <img src="https://fantacoppa.altervista.org/<?php echo htmlspecialchars($currentLogo); ?>" 
                                             alt="Logo Squadra" 
                                             style="width: 100%; height: 100%; border-radius: 60px; object-fit: cover;">
                                    <?php endif; ?>
                                    </div>
                                <button type="button" 
                                        class="btn btn-sm btn-primary position-absolute" 
                                        style="bottom: 0; right: 0; width: 36px; height: 36px; border-radius: 18px; border: 3px solid #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"
                                        onclick="openLogoModal()">
                                    <i class="bi bi-pencil"></i>
                                </button>
                                </div>
                            
                            <!-- Nome Squadra e Allenatore -->
                            <div class="row g-2 mb-3">
                                <div class="col-6">
                                    <div class="input-group">
                                        <span class="input-group-text"><i class="bi bi-shield"></i></span>
                                        <input type="text" class="form-control" id="team_name" placeholder="Squadra" 
                                               value="<?php echo htmlspecialchars($currentUserTeamInfo['team_name'] ?? ''); ?>">
                                    </div>
                                </div>
                                <div class="col-6">
                                    <div class="input-group">
                                        <span class="input-group-text"><i class="bi bi-person-badge"></i></span>
                                        <input type="text" class="form-control" id="coach_name" placeholder="Allenatore" 
                                               value="<?php echo htmlspecialchars($currentUserTeamInfo['coach_name'] ?? ''); ?>">
                            </div>
                                </div>
                            </div>
                            
                            <button type="button" class="btn btn-primary" onclick="saveTeamInfo()">
                                    <i class="bi bi-check-circle me-1"></i>
                                <span id="saveButtonText">Salva</span>
                                </button>
                            </div>
                    </div>
                    
                    <!-- Modal Logo -->
                    <div class="modal fade" id="logoModal" tabindex="-1">
                        <div class="modal-dialog modal-dialog-scrollable">
                            <div class="modal-content">
                                <div class="modal-header">
                                    <h5 class="modal-title">Scegli Logo</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                                <div class="modal-body">
                                    <h6>Loghi di default:</h6>
                                    <div class="d-flex flex-wrap gap-3 mb-4" id="defaultLogosGrid">
                                        <?php foreach ($defaultLogos as $logoId => $logoData): ?>
                                            <button type="button" 
                                                    class="btn btn-outline-secondary p-0 rounded-circle default-logo-btn <?php echo ($currentLogo === $logoId) ? 'border-success border-3' : ''; ?>" 
                                                    style="width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; font-size: 32px; background-color: <?php echo $logoData['color']; ?>30;"
                                                    onclick="selectDefaultLogo('<?php echo $logoId; ?>')"
                                                    data-logo-id="<?php echo $logoId; ?>">
                                                <?php echo $logoData['emoji']; ?>
                                            </button>
                                        <?php endforeach; ?>
                                    </div>
                                    
                                    <hr>
                                    
                                    <h6>O carica un'immagine personalizzata:</h6>
                                    <div class="mb-3">
                                        <input type="file" class="form-control" id="logoFile" accept="image/jpeg,image/jpg,image/png" onchange="handleFileSelect(event)">
                                        <small class="text-muted">Formati supportati: JPG, PNG. Dimensione massima: 2MB</small>
                                    </div>
                                    
                                    <?php if (!$isDefaultLogo): ?>
                                        <button type="button" class="btn btn-danger w-100" onclick="removeCustomLogo()">
                                            <i class="bi bi-trash me-1"></i>
                                            Rimuovi Logo Personalizzato
                                        </button>
                                    <?php endif; ?>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <?php elseif ($section === 'calendar'): ?>
        <!-- Gestione Calendario -->
        <div class="row">
            <div class="col-md-8">
                <div class="card settings-card mb-4">
                    <div class="card-header bg-primary text-white d-flex align-items-center">
                        <i class="bi bi-calendar-event me-2"></i>
                        <h5 class="mb-0">Gestione Calendario</h5>
                    </div>
                    <div class="card-body">
                        <div class="alert alert-info mb-3">
                            <i class="bi bi-info-circle"></i> Clicca su una data vuota per creare una nuova giornata, o su una giornata esistente per modificarla.
                        </div>
                        <div id="calendar" style="max-width: 100%; height: 600px;"></div>
                    </div>
                </div>
            </div>
            <div class="col-md-4">
                <div class="card settings-card mb-4">
                    <div class="card-header bg-secondary text-white d-flex align-items-center">
                        <i class="bi bi-pencil-square me-2"></i>
                        <h5 class="mb-0">Gestione Giornata</h5>
                    </div>
                    <div class="card-body">
                        <form id="matchdayForm" method="POST" class="d-none">
                            <input type="hidden" name="action" value="update_matchday">
                            <input type="hidden" name="giornata" id="selectedGiornata">
                            <input type="hidden" name="deadline_date" id="deadline_date">
                            <input type="hidden" name="matchday_id" id="matchday_id">
                            <div class="mb-3">
                                <label class="form-label">Giornata: <span id="giornataDisplay" class="fw-bold badge badge-giornata"></span></label>
                            </div>
                            <div class="mb-3">
                                <label class="form-label">Data selezionata:</label>
                                <div id="selectedDateDisplay" class="form-control-plaintext fw-bold"></div>
                            </div>
                            <div class="mb-3">
                                <label for="deadline_time" class="form-label">Orario limite per la formazione:</label>
                                <input type="time" class="form-control" id="deadline_time" name="deadline_time" required>
                            </div>
                            <div class="d-flex gap-2">
                                <button type="submit" class="btn btn-primary flex-grow-1">
                                    <i class="bi bi-save"></i> Salva
                                </button>
                                <button type="button" class="btn btn-danger flex-grow-1" id="deleteMatchday" data-bs-toggle="modal" data-bs-target="#deleteMatchdayModal">
                                    <i class="bi bi-trash"></i> Elimina
                                </button>
                            </div>
                        </form>
                        <div id="noSelection" class="text-center text-muted py-4">
                            <i class="bi bi-calendar-plus fa-2x mb-2"></i>
                            <p>Seleziona una data nel calendario per creare o modificare una giornata</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <!-- Modal conferma eliminazione giornata -->
        <div class="modal fade" id="deleteMatchdayModal" tabindex="-1" aria-labelledby="deleteMatchdayModalLabel" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header bg-danger text-white">
                <h5 class="modal-title" id="deleteMatchdayModalLabel"><i class="bi bi-exclamation-triangle-fill me-2"></i>Conferma eliminazione giornata</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Chiudi"></button>
              </div>
              <div class="modal-body">
                Sei sicuro di voler eliminare questa giornata?<br><span class="text-danger fw-bold">Questa azione non può essere annullata.</span>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><i class="bi bi-x-circle"></i> Annulla</button>
                <button type="button" class="btn btn-danger" id="confirmDeleteMatchday"><i class="bi bi-trash"></i> Elimina</button>
              </div>
            </div>
          </div>
        </div>
        <!-- Modal conferma rimozione utente -->
        <div class="modal fade" id="removeUserModal" tabindex="-1" aria-labelledby="removeUserModalLabel" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header bg-danger text-white">
                <h5 class="modal-title" id="removeUserModalLabel"><i class="bi bi-exclamation-triangle-fill me-2"></i>Conferma rimozione utente</h5>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Chiudi"></button>
              </div>
              <div class="modal-body">
                <span id="removeUserModalText">Sei sicuro di voler rimuovere questo utente dalla lega? Verranno eliminati anche i suoi giocatori acquistati e il budget associato.</span>
                <div class="alert alert-warning mb-0 py-2 px-3 mt-3"><i class="bi bi-info-circle"></i> Questa azione è irreversibile.</div>
              </div>
              <div class="modal-footer">
                <form method="POST" id="removeUserForm">
                  <input type="hidden" name="action" value="remove_user">
                  <input type="hidden" name="remove_user_id" id="removeUserIdInput">
                  <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><i class="bi bi-x-circle"></i> Annulla</button>
                  <button type="submit" class="btn btn-danger"><i class="bi bi-person-x"></i> Rimuovi</button>
                </form>
              </div>
            </div>
          </div>
        </div>
        <?php elseif ($section === 'calculate'): ?>
        <!-- Calcola Giornata -->
        <div class="row">
            <div class="col-md-8 mx-auto">
                <div class="card settings-card">
                    <div class="card-header bg-primary text-white d-flex align-items-center">
                        <i class="bi bi-calculator me-2"></i>
                        <h5 class="mb-0">Calcola Giornata</h5>
                    </div>
                    <div class="card-body">
                        <p class="text-muted small mb-3">
                            Calcola i punteggi di una giornata per aggiornarli nella classifica. Solo le giornate calcolate contano per la classifica generale.
                        </p>
                        <div id="calcContainer">
                            <div class="text-center py-3">
                                <div class="spinner-border text-primary" role="status"></div>
                                <p class="mt-2 text-muted">Caricamento giornate...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <?php endif; ?>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <?php if ($section === 'calendar'): ?>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const isAdmin = true;
            const calendar = new FullCalendar.Calendar(document.getElementById('calendar'), {
                initialView: 'dayGridMonth',
                locale: 'it',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'dayGridMonth,dayGridWeek'
                },
                height: 'auto',
                contentHeight: 550,
                selectable: true,
                select: function(info) {
                    const selectedDate = info.startStr;
                    const existingEvent = calendar.getEvents().find(event => 
                        event.start.toISOString().split('T')[0] === selectedDate
                    );

                    if (existingEvent) {
                        // Modifica giornata esistente
                        document.getElementById('selectedGiornata').value = existingEvent.extendedProps.giornata;
                        document.getElementById('giornataDisplay').textContent = existingEvent.extendedProps.giornata;
                        document.getElementById('deadline_date').value = selectedDate;
                        document.getElementById('selectedDateDisplay').textContent = new Date(selectedDate).toLocaleDateString('it-IT', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                        document.getElementById('deadline_time').value = existingEvent.extendedProps.deadline_time;
                        document.getElementById('matchday_id').value = existingEvent.extendedProps.id;
                        document.getElementById('matchdayForm').classList.remove('d-none');
                        document.getElementById('noSelection').classList.add('d-none');
                        // Mostra il pulsante elimina per giornate esistenti (solo se admin)
                        if (isAdmin) {
                            document.getElementById('deleteMatchday').style.display = 'block';
                        }
                    } else {
                        // Per nuove giornate, non assegniamo un numero specifico
                        // Il server si occuperà di riordinare cronologicamente
                        document.getElementById('selectedGiornata').value = '0'; // Placeholder
                        document.getElementById('giornataDisplay').textContent = 'Nuova';
                        document.getElementById('deadline_date').value = info.startStr;
                        document.getElementById('selectedDateDisplay').textContent = new Date(info.startStr).toLocaleDateString('it-IT', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                        document.getElementById('deadline_time').value = '<?php echo $league['default_deadline_time']; ?>';
                        document.getElementById('matchday_id').value = '';
                        document.getElementById('matchdayForm').classList.remove('d-none');
                        document.getElementById('noSelection').classList.add('d-none');
                        // Nascondi il pulsante elimina per nuove giornate (solo se admin)
                        if (isAdmin) {
                            document.getElementById('deleteMatchday').style.display = 'none';
                        }
                    }
                },
                eventClick: function(info) {
                    if (!isAdmin) return;
                    
                    document.getElementById('selectedGiornata').value = info.event.extendedProps.giornata;
                    document.getElementById('giornataDisplay').textContent = info.event.extendedProps.giornata;
                    document.getElementById('deadline_date').value = info.event.start.toISOString().split('T')[0];
                    document.getElementById('selectedDateDisplay').textContent = info.event.start.toLocaleDateString('it-IT', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                    document.getElementById('deadline_time').value = info.event.extendedProps.deadline_time;
                    document.getElementById('matchday_id').value = info.event.extendedProps.id;
                    document.getElementById('matchdayForm').classList.remove('d-none');
                    document.getElementById('noSelection').classList.add('d-none');
                    // Mostra il pulsante elimina per giornate esistenti (solo se admin)
                    if (isAdmin) {
                        document.getElementById('deleteMatchday').style.display = 'block';
                    }
                }
            });
            
            calendar.render();
            
            // Aggiungi gli eventi esistenti
            <?php foreach ($events as $event): ?>
            calendar.addEvent({
                title: '<?php echo $event['title']; ?>',
                start: '<?php echo $event['start']; ?>',
                allDay: <?php echo $event['allDay'] ? 'true' : 'false'; ?>,
                backgroundColor: '<?php echo $event['backgroundColor']; ?>',
                borderColor: '<?php echo $event['borderColor']; ?>',
                textColor: '<?php echo $event['textColor']; ?>',
                extendedProps: {
                    giornata: <?php echo $event['giornata']; ?>,
                    deadline_time: '<?php echo $event['deadline_time']; ?>',
                    id: <?php echo $event['id']; ?>
                }
            });
            <?php endforeach; ?>
            
            // Gestione eliminazione giornata con modale
            document.getElementById('confirmDeleteMatchday').addEventListener('click', function() {
                const giornata = document.getElementById('selectedGiornata').value;
                const deleteForm = document.createElement('form');
                deleteForm.method = 'POST';
                deleteForm.innerHTML = `
                    <input type="hidden" name="action" value="delete_matchday">
                    <input type="hidden" name="giornata" value="${giornata}">
                `;
                document.body.appendChild(deleteForm);
                deleteForm.submit();
            });

            // Gestione modale rimozione utente
            document.querySelectorAll('.remove-user-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var userId = btn.getAttribute('data-user-id');
                    var username = btn.getAttribute('data-username');
                    document.getElementById('removeUserIdInput').value = userId;
                    document.getElementById('removeUserModalText').innerHTML = 'Sei sicuro di voler rimuovere l\'utente <b>' + username + '</b> dalla lega? Verranno eliminati anche i suoi giocatori acquistati e il budget associato.';
                    var modal = new bootstrap.Modal(document.getElementById('removeUserModal'));
                    modal.show();
                });
            });
        });
    </script>
    <?php endif; ?>
    <?php if ($section === 'calculate'): ?>
    <script>
    document.addEventListener('DOMContentLoaded', async function() {
        const leagueId = <?php echo $league_id; ?>;
        const authToken = <?php echo json_encode($authToken); ?>;
        const container = document.getElementById('calcContainer');
        let matchdays = [];
        let selectedGiornata = null;

        async function apiCall(url, method = 'GET', body = null) {
            const opts = {
                method,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            };
            if (body) opts.body = JSON.stringify(body);
            const res = await fetch('/api.php' + url, opts);
            return res.json();
        }

        async function loadStatus() {
            try {
                matchdays = await apiCall('/leagues/' + leagueId + '/matchday-status');
                renderUI();
            } catch (e) {
                container.innerHTML = '<div class="alert alert-danger">Errore nel caricamento</div>';
            }
        }

        function renderUI() {
            if (!matchdays.length) {
                container.innerHTML = '<div class="alert alert-info">Nessuna giornata disponibile.</div>';
                return;
            }
            // Auto-select first uncalculated with votes
            if (!selectedGiornata) {
                const now = new Date();
                const uncalc = matchdays.find(m => m.has_votes && !m.is_calculated && (!m.deadline || new Date(m.deadline) < now));
                selectedGiornata = uncalc ? uncalc.giornata : matchdays[matchdays.length - 1].giornata;
            }

            let html = '<div class="mb-3"><label class="form-label fw-bold">Seleziona giornata</label><div class="d-flex flex-wrap gap-2">';
            matchdays.forEach(m => {
                const sel = m.giornata === selectedGiornata;
                let cls = 'btn btn-sm ';
                if (m.is_calculated) cls += sel ? 'btn-success' : 'btn-outline-success';
                else if (m.has_votes) cls += sel ? 'btn-primary' : 'btn-outline-warning';
                else cls += sel ? 'btn-secondary' : 'btn-outline-secondary';
                html += '<button class="' + cls + '" onclick="selectGiornata(' + m.giornata + ')">G' + m.giornata;
                if (m.is_calculated) html += ' <i class="bi bi-check-circle-fill"></i>';
                html += '</button>';
            });
            html += '</div></div>';

            const md = matchdays.find(m => m.giornata === selectedGiornata);
            if (md) {
                html += '<div class="card mb-3"><div class="card-body">';
                html += '<div class="d-flex justify-content-between"><span class="text-muted">Stato:</span><span class="badge ' + (md.is_calculated ? 'bg-success' : 'bg-warning text-dark') + '">' + (md.is_calculated ? 'Calcolata' : 'Non calcolata') + '</span></div>';
                if (md.is_calculated && md.calculated_at) html += '<div class="d-flex justify-content-between mt-1"><span class="text-muted">Calcolata il:</span><span>' + new Date(md.calculated_at).toLocaleString('it-IT') + '</span></div>';
                html += '<div class="d-flex justify-content-between mt-1"><span class="text-muted">Voti inseriti:</span><span>' + (md.has_votes ? md.votes_count + ' giocatori' : 'Nessuno') + '</span></div>';
                html += '</div></div>';
            }

            html += '<div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="use6Politico"><label class="form-check-label" for="use6Politico">Applica 6 politico alle squadre senza voti</label></div>';
            html += '<button class="btn btn-primary w-100" id="calcBtn" onclick="doCalc(false)"><i class="bi bi-calculator me-1"></i>' + (md && md.is_calculated ? 'Ricalcola Giornata' : 'Calcola Giornata') + '</button>';
            html += '<div id="calcResults" class="mt-3"></div>';
            container.innerHTML = html;
        }

        window.selectGiornata = function(g) {
            selectedGiornata = g;
            renderUI();
        };

        window.doCalc = async function(force) {
            const btn = document.getElementById('calcBtn');
            const use6P = document.getElementById('use6Politico')?.checked || false;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Calcolo in corso...';

            try {
                const data = await apiCall('/leagues/' + leagueId + '/calculate/' + selectedGiornata, 'POST', { use_6_politico: use6P, force: force });
                if (data.already_calculated && !force) {
                    if (confirm('Giornata già calcolata. Vuoi ricalcolare? I risultati precedenti verranno sovrascritti.')) {
                        doCalc(true);
                    } else {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="bi bi-calculator me-1"></i>Ricalcola Giornata';
                    }
                    return;
                }

                let rHtml = '<div class="alert alert-success"><i class="bi bi-check-circle me-1"></i>' + (data.recalculated ? 'Giornata ricalcolata!' : 'Giornata calcolata!') + '</div>';
                if (data.users_with_6_politico && data.users_with_6_politico.length) {
                    rHtml += '<div class="alert alert-warning small">6 politico applicato a: ' + data.users_with_6_politico.join(', ') + '</div>';
                }
                document.getElementById('calcResults').innerHTML = rHtml;
                await loadStatus();
            } catch (e) {
                document.getElementById('calcResults').innerHTML = '<div class="alert alert-danger">Errore: ' + (e.message || 'Impossibile calcolare') + '</div>';
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-calculator me-1"></i>Calcola Giornata';
            }
        };

        await loadStatus();
    });
    </script>
    <?php endif; ?>
    <script>
    document.addEventListener('DOMContentLoaded', function() {
        // 1) Cambio ruolo autosalvante
        const currentUserId = <?php echo json_encode($user_id); ?>;
        document.querySelectorAll('.role-select').forEach(function(sel) {
            sel.addEventListener('change', function() {
                const memberId = this.getAttribute('data-member-id');
                const userId = this.getAttribute('data-user-id');
                const newRole = this.value;
                const isSelf = userId == currentUserId;
                // Se l'utente sta cambiando il proprio ruolo da admin a altro, controlla se è l'unico admin
                if (isSelf && newRole !== 'admin') {
                    // Conta quanti admin ci sono, escludendo il select corrente se sta cambiando da admin a altro
                    const adminCount = Array.from(document.querySelectorAll('.role-select'))
                        .filter(sel2 => sel2 !== this && sel2.value === 'admin').length
                        + (this.value === 'admin' ? 1 : 0);
                    if (adminCount < 1) {
                        const alertBox = document.getElementById('adminRoleAlert');
                        alertBox.innerHTML = `
                          <div class="alert alert-danger alert-dismissible fade show mt-2" role="alert">
                            <i class="bi bi-exclamation-triangle-fill me-2"></i>
                            Devi nominare almeno un altro admin prima di poter cambiare ruolo all'ultimo admin della lega.
                            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Chiudi"></button>
                          </div>
                        `;
                        setTimeout(() => {
                          const alert = bootstrap.Alert.getOrCreateInstance(document.querySelector('#adminRoleAlert .alert'));
                          if (alert) alert.close();
                        }, 5000);
                        this.value = 'admin';
                        return;
                    }
                }
                this.disabled = true;
                fetch('impostazioni.php?league_id=<?php echo $league_id; ?>&section=users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `action=change_role&member_id=${memberId}&new_role=${newRole}`
                }).then(() => window.location.reload());
            });
        });
        // 2) Rimozione utente con alert moderno
        document.querySelectorAll('.remove-user-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var userId = btn.getAttribute('data-user-id');
                var username = btn.getAttribute('data-username');
                let modalHtml = `<div class='modal fade' id='removeUserModal' tabindex='-1' aria-labelledby='removeUserModalLabel' aria-hidden='true'>
                    <div class='modal-dialog modal-dialog-centered'>
                      <div class='modal-content'>
                        <div class='modal-header bg-danger text-white'>
                          <h5 class='modal-title' id='removeUserModalLabel'><i class='bi bi-exclamation-triangle-fill me-2'></i>Conferma rimozione utente</h5>
                          <button type='button' class='btn-close btn-close-white' data-bs-dismiss='modal' aria-label='Chiudi'></button>
                        </div>
                        <div class='modal-body'>
                          Sei sicuro di voler rimuovere l\'utente <b>${username}</b> dalla lega?<br><span class='text-danger fw-bold'>Verranno eliminati anche i suoi giocatori acquistati e il budget associato.</span>
                        </div>
                        <div class='modal-footer'>
                          <button type='button' class='btn btn-secondary' data-bs-dismiss='modal'><i class='bi bi-x-circle'></i> Annulla</button>
                          <button type='button' class='btn btn-danger' id='confirmRemoveUserBtn'><i class='bi bi-person-x'></i> Rimuovi</button>
                        </div>
                      </div>
                    </div>
                  </div>`;
                let tempDiv = document.createElement('div');
                tempDiv.innerHTML = modalHtml;
                document.body.appendChild(tempDiv.firstChild);
                var removeModal = new bootstrap.Modal(document.getElementById('removeUserModal'));
                removeModal.show();
                document.getElementById('confirmRemoveUserBtn').addEventListener('click', function() {
                    this.disabled = true;
                    this.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Rimozione...';
                    fetch('impostazioni.php?league_id=<?php echo $league_id; ?>&section=users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: `action=remove_user&remove_user_id=${userId}`
                    }).then(() => window.location.reload());
                });
                document.getElementById('removeUserModal').addEventListener('hidden.bs.modal', function() {
                    document.getElementById('removeUserModal').remove();
                });
            });
        });
        // 3) Abbandona lega: alert smart
        document.querySelectorAll('.leave-league-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                fetch('leave_league.php?action=info&league_id=<?php echo $league_id; ?>')
                    .then(res => res.json())
                    .then(data => {
                        let modalHtml = '';
                        if (data.only_user) {
                            modalHtml = `<div class='modal fade' id='leaveLeagueModal' tabindex='-1' aria-labelledby='leaveLeagueModalLabel' aria-hidden='true'>
                                <div class='modal-dialog modal-dialog-centered'>
                                  <div class='modal-content'>
                                    <div class='modal-header bg-danger text-white'>
                                      <h5 class='modal-title' id='leaveLeagueModalLabel'><i class='bi bi-exclamation-triangle-fill me-2'></i>Conferma eliminazione lega</h5>
                                      <button type='button' class='btn-close btn-close-white' data-bs-dismiss='modal' aria-label='Chiudi'></button>
                                    </div>
                                    <div class='modal-body'>
                                      Sei l\'unico utente della lega.<br><span class='text-danger fw-bold'>Se confermi, la lega verrà eliminata definitivamente dal sistema con tutti i suoi dati.</span>
                                    </div>
                                    <div class='modal-footer'>
                                      <button type='button' class='btn btn-secondary' data-bs-dismiss='modal'><i class='bi bi-x-circle'></i> Annulla</button>
                                      <button type='button' class='btn btn-danger' id='confirmLeaveLeagueBtn'><i class='bi bi-trash'></i> Elimina lega</button>
                                    </div>
                                  </div>
                                </div>
                              </div>`;
                        } else if (data.only_admin) {
                            let options = '';
                            data.other_members.forEach(function(m) {
                                options += `<option value="${m.user_id}">${m.username}</option>`;
                            });
                            let disabled = data.other_members.length === 0 ? 'disabled' : '';
                            let warning = data.other_members.length === 0
                                ? `<div class='alert alert-danger mt-2'><i class='bi bi-exclamation-triangle'></i> Non puoi abbandonare la lega finché non ci sono altri membri a cui assegnare il ruolo di admin.</div>`
                                : `<div class='alert alert-warning'><i class='bi bi-info-circle'></i> Dopo la nomina, perderai i privilegi di amministratore e verrai rimosso dalla lega.</div>`;
                            modalHtml = `<div class='modal fade' id='leaveLeagueModal' tabindex='-1' aria-labelledby='leaveLeagueModalLabel' aria-hidden='true'>
                                <div class='modal-dialog modal-dialog-centered'>
                                  <div class='modal-content'>
                                    <div class='modal-header bg-danger text-white'>
                                      <h5 class='modal-title' id='leaveLeagueModalLabel'><i class='bi bi-exclamation-triangle-fill me-2'></i>Devi nominare un nuovo admin</h5>
                                      <button type='button' class='btn-close btn-close-white' data-bs-dismiss='modal' aria-label='Chiudi'></button>
                                    </div>
                                    <div class='modal-body'>
                                      <p>Sei l\'unico admin della lega. Prima di uscire devi nominare un nuovo admin tra i membri:</p>
                                      <select class='form-select mb-3' id='newAdminSelect' ${disabled}>${options}</select>
                                      ${warning}
                                    </div>
                                    <div class='modal-footer'>
                                      <button type='button' class='btn btn-secondary' data-bs-dismiss='modal'><i class='bi bi-x-circle'></i> Annulla</button>
                                      <button type='button' class='btn btn-danger' id='confirmLeaveLeagueBtn' ${disabled}><i class='bi bi-box-arrow-left'></i> Conferma e abbandona</button>
                                    </div>
                                  </div>
                                </div>
                              </div>`;
                        } else {
                            modalHtml = `<div class='modal fade' id='leaveLeagueModal' tabindex='-1' aria-labelledby='leaveLeagueModalLabel' aria-hidden='true'>
                                <div class='modal-dialog modal-dialog-centered'>
                                  <div class='modal-content'>
                                    <div class='modal-header bg-danger text-white'>
                                      <h5 class='modal-title' id='leaveLeagueModalLabel'><i class='bi bi-exclamation-triangle-fill me-2'></i>Conferma abbandono lega</h5>
                                      <button type='button' class='btn-close btn-close-white' data-bs-dismiss='modal' aria-label='Chiudi'></button>
                                    </div>
                                    <div class='modal-body'>
                                      Sei sicuro di voler abbandonare la lega?<br><span class='text-danger fw-bold'>Tutti i tuoi dati relativi a questa lega verranno eliminati.</span>
                                    </div>
                                    <div class='modal-footer'>
                                      <button type='button' class='btn btn-secondary' data-bs-dismiss='modal'><i class='bi bi-x-circle'></i> Annulla</button>
                                      <button type='button' class='btn btn-danger' id='confirmLeaveLeagueBtn'><i class='bi bi-box-arrow-left'></i> Abbandona lega</button>
                                    </div>
                                  </div>
                                </div>
                              </div>`;
                        }
                        let tempDiv = document.createElement('div');
                        tempDiv.innerHTML = modalHtml;
                        document.body.appendChild(tempDiv.firstChild);
                        var leaveModal = new bootstrap.Modal(document.getElementById('leaveLeagueModal'));
                        leaveModal.show();
                        if ((data.only_admin && data.other_members.length === 0)) return;
                        document.getElementById('confirmLeaveLeagueBtn').addEventListener('click', function() {
                            this.disabled = true;
                            this.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Abbandono...';
                            let newAdminId = null;
                            if (data.only_admin) {
                                newAdminId = document.getElementById('newAdminSelect').value;
                            }
                            fetch('leave_league.php', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ league_id: <?php echo $league_id; ?>, new_admin_id: newAdminId })
                            })
                            .then(res => res.json())
                            .then(data => {
                                if (data.success) {
                                    window.location.href = 'dashboard.php';
                                } else {
                                    alert(data.error || 'Errore durante l\'uscita dalla lega.');
                                    this.disabled = false;
                                    this.innerHTML = '<i class="bi bi-box-arrow-left"></i> Abbandona lega';
                                }
                            });
                        });
                        document.getElementById('leaveLeagueModal').addEventListener('hidden.bs.modal', function() {
                            document.getElementById('leaveLeagueModal').remove();
                        });
                    });
            });
        });
        
        // Market management toggles
        document.getElementById('market_locked')?.addEventListener('change', function() {
            updateMarketSettings('market_locked', this.checked ? 1 : 0);
        });
        
        document.getElementById('require_approval')?.addEventListener('change', function() {
            updateMarketSettings('require_approval', this.checked ? 1 : 0);
        });
        
        // Individual user market blocks
        document.querySelectorAll('input[data-user-id]').forEach(function(toggle) {
            toggle.addEventListener('change', function() {
                const userId = this.getAttribute('data-user-id');
                const blocked = this.checked ? 1 : 0;
                updateUserMarketBlock(userId, blocked);
            });
        });
        
        // User search functionality with intelligent filtering
        const userSearch = document.getElementById('teamSearch');
        const filterInfo = document.getElementById('searchResults');
        const clearSearch = document.getElementById('clearSearch');
        
        if (userSearch) {
            userSearch.addEventListener('input', function() {
                const searchTerm = this.value.toLowerCase().trim();
                const userItems = document.querySelectorAll('.user-item');
                const isMarketGloballyLocked = document.getElementById('market_locked').checked;
                
                // Show/hide clear button
                if (clearSearch) {
                    if (searchTerm.length > 0) {
                        clearSearch.style.display = 'block';
                    } else {
                        clearSearch.style.display = 'none';
                    }
                }
                
                // Update filter info text
                if (searchTerm === '') {
                    if (isMarketGloballyLocked) {
                        filterInfo.textContent = 'Mostrando solo utenti con mercato sbloccato (eccezioni)';
                    } else {
                        filterInfo.textContent = 'Mostrando solo utenti con mercato bloccato';
                    }
                } else {
                    filterInfo.textContent = `Ricerca per: "${searchTerm}"`;
                }
                
                userItems.forEach(function(item) {
                    const username = item.getAttribute('data-username') || '';
                    const teamName = item.getAttribute('data-team-name') || '';
                    const coachName = item.getAttribute('data-coach-name') || '';
                    const blocked = parseInt(item.getAttribute('data-blocked')) === 1;
                    
                    // If search bar is empty, show only relevant users based on global market status
                    if (searchTerm === '') {
                        if (isMarketGloballyLocked) {
                            // Market is globally locked: show only unblocked users (exceptions)
                            item.style.display = !blocked ? 'flex' : 'none';
                        } else {
                            // Market is globally active: show only blocked users
                            item.style.display = blocked ? 'flex' : 'none';
                        }
                    } else {
                        // If searching, show all users that match the search term (username, team name, or coach name)
                        if (username.includes(searchTerm) || 
                            teamName.includes(searchTerm) || 
                            coachName.includes(searchTerm)) {
                            item.style.display = 'flex';
                        } else {
                            item.style.display = 'none';
                        }
                    }
                });
            });
            
            // Clear search functionality
            if (clearSearch) {
                clearSearch.addEventListener('click', function() {
                    userSearch.value = '';
                    clearSearch.style.display = 'none';
                    userSearch.dispatchEvent(new Event('input'));
                });
            }
            
            // Initialize the filter on page load
            userSearch.dispatchEvent(new Event('input'));
        }
        
        // Initialize tooltips
        var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    });
    
    function updateMarketSettings(setting, value) {
        const toggle = document.getElementById(setting);
        const originalState = toggle.checked;
        
        fetch('update_market_settings.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `league_id=<?php echo $league_id; ?>&setting=${setting}&value=${value}`
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast('Impostazioni aggiornate con successo', 'success');
                // Keep the toggle in its current state (don't revert)
                // Update the status badge if market_locked setting changed
                if (setting === 'market_locked') {
                    updateMarketStatusBadge(value);
                }
            } else {
                console.error('Error updating market settings:', data.error);
                showToast('Errore nell\'aggiornamento delle impostazioni', 'error');
                // Revert the toggle to original state
                toggle.checked = originalState;
            }
        })
        .catch(error => {
            console.error('Error:', error);
            //showToast('Errore di connessione', 'error');
            // Revert the toggle to original state
            toggle.checked = originalState;
        });
    }
    
    function updateUserMarketBlock(userId, blocked) {
        const toggle = document.querySelector(`input[data-user-id="${userId}"]`);
        const originalState = toggle.checked;
        
        fetch('update_user_market_block.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `league_id=<?php echo $league_id; ?>&user_id=${userId}&blocked=${blocked}`
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showToast('Blocco utente aggiornato con successo', 'success');
                // Keep the toggle in its current state (don't revert)
            } else {
                console.error('Error updating user market block:', data.error);
                showToast('Errore nell\'aggiornamento del blocco utente', 'error');
                // Revert the toggle to original state
                toggle.checked = originalState;
            }
        })
        .catch(error => {
            console.error('Error:', error);
            //showToast('Errore di connessione', 'error');
            // Revert the toggle to original state
            toggle.checked = originalState;
        });
    }
    
    function updateMarketStatusBadge(isLocked) {
        const badge = document.querySelector('.alert-info .badge');
        if (badge) {
            if (isLocked) {
                badge.className = 'badge bg-danger';
                badge.textContent = 'Mercato Bloccato';
            } else {
                badge.className = 'badge bg-success';
                badge.textContent = 'Mercato Attivo';
            }
        }
        
        // Update the user filter when global market status changes
        const userSearch = document.getElementById('teamSearch');
        if (userSearch) {
            userSearch.dispatchEvent(new Event('input'));
        }
    }
    
    function showToast(message, type = 'info') {
        // Create toast container if it doesn't exist
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
            toastContainer.style.zIndex = '9999';
            document.body.appendChild(toastContainer);
        }
        
        // Create toast element
        const toastId = 'toast-' + Date.now();
        const alertClass = type === 'success' ? 'alert-success' : 
                          type === 'error' ? 'alert-danger' : 'alert-info';
        const iconClass = type === 'success' ? 'bi-check-circle' : 
                         type === 'error' ? 'bi-exclamation-triangle' : 'bi-info-circle';
        
        const toastHtml = `
            <div id="${toastId}" class="toast align-items-center text-white ${alertClass} border-0" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi ${iconClass} me-2"></i>${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;
        
        toastContainer.insertAdjacentHTML('beforeend', toastHtml);
        
        // Show the toast
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement, {
            autohide: true,
            delay: 3000
        });
        toast.show();
        
        // Remove the toast element after it's hidden
        toastElement.addEventListener('hidden.bs.toast', function() {
            toastElement.remove();
        });
    }
    
    // Token JWT per chiamate API
    const authToken = '<?php echo $authToken; ?>';
    const leagueId = <?php echo $league_id; ?>;
    
    // Funzioni per gestire il logo
    async function makeAPICall(endpoint, method = 'GET', body = null, isFormData = false) {
        const headers = {};
        
        if (!isFormData) {
            headers['Content-Type'] = 'application/json';
        }
        headers['Authorization'] = `Bearer ${authToken}`;
        
        const options = {
            method: method,
            headers: headers
        };
        
        if (body) {
            if (isFormData) {
                options.body = body;
            } else {
                options.body = JSON.stringify(body);
            }
        }
        
        return fetch(endpoint, options);
    }
    
    function openLogoModal() {
        const modal = new bootstrap.Modal(document.getElementById('logoModal'));
        modal.show();
    }
    
    async function selectDefaultLogo(logoId) {
        try {
            const response = await makeAPICall(`/api.php/leagues/${leagueId}/team-info/logo/default`, 'POST', { logo_id: logoId });
            const data = await response.json();
            
            if (response.ok) {
                updateLogoDisplay(logoId, true);
                const modal = bootstrap.Modal.getInstance(document.getElementById('logoModal'));
                if (modal) modal.hide();
                showToast('Logo selezionato con successo', 'success');
            } else {
                showToast(data.message || 'Errore nella selezione del logo', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showToast('Errore di connessione', 'error');
        }
    }
    
    async function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Verifica formato
        if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
            showToast('Formato non supportato. Usa JPG o PNG', 'error');
            return;
        }
        
        // Verifica dimensione (2MB)
        if (file.size > 2 * 1024 * 1024) {
            showToast('Il file è troppo grande. Massimo 2MB', 'error');
            return;
        }
        
        try {
            const formData = new FormData();
            formData.append('logo', file);
            
            const response = await fetch(`/api.php/leagues/${leagueId}/team-info/logo`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`
                },
                body: formData
            });
            
            const data = await response.json();
            
            if (response.ok) {
                updateLogoDisplay(data.logo_path || 'custom', false);
                const modal = bootstrap.Modal.getInstance(document.getElementById('logoModal'));
                if (modal) modal.hide();
                showToast('Logo caricato con successo', 'success');
            } else {
                showToast(data.message || 'Errore nel caricamento del logo', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showToast('Errore di connessione', 'error');
        }
        
        // Reset input file
        event.target.value = '';
    }
    
    async function removeCustomLogo() {
        if (!confirm('Sei sicuro di voler rimuovere il logo personalizzato?')) return;
        
        try {
            const response = await makeAPICall(`/api.php/leagues/${leagueId}/team-info/logo`, 'DELETE');
            const data = await response.json();
            
            if (response.ok) {
                updateLogoDisplay('default_1', true);
                const modal = bootstrap.Modal.getInstance(document.getElementById('logoModal'));
                if (modal) modal.hide();
                showToast('Logo rimosso con successo', 'success');
            } else {
                showToast(data.message || 'Errore nella rimozione del logo', 'error');
            }
        } catch (error) {
            console.error('Error:', error);
            showToast('Errore di connessione', 'error');
        }
    }
    
    function updateLogoDisplay(logoId, isDefault) {
        const defaultLogos = {
            'default_1': { emoji: '⚽', color: '#4CAF50' },
            'default_2': { emoji: '⚔️', color: '#F44336' },
            'default_3': { emoji: '🛡️', color: '#2196F3' },
            'default_4': { emoji: '🏴‍☠️', color: '#CCAAEE' },
            'default_5': { emoji: '🐺', color: '#9C27B0' },
            'default_6': { emoji: '🐍', color: '#1976D2' },
            'default_7': { emoji: '🦁', color: '#FF9800' },
            'default_8': { emoji: '🦉', color: '#E91E63' },
            'default_9': { emoji: '🔰', color: '#FFD700' },
            'default_10': { emoji: '💣', color: '#8D6E63' },
            'default_11': { emoji: '💎', color: '#8B4513' },
            'default_12': { emoji: '🛸', color: '#607D8B' },
        };
        
        const logoContainer = document.getElementById('currentLogo');
        
        if (isDefault && defaultLogos[logoId]) {
            logoContainer.innerHTML = defaultLogos[logoId].emoji;
            logoContainer.style.backgroundColor = defaultLogos[logoId].color + '30';
        } else {
            logoContainer.innerHTML = `<img src="https://fantacoppa.altervista.org/${logoId}" alt="Logo Squadra" style="width: 100%; height: 100%; border-radius: 60px; object-fit: cover;">`;
            logoContainer.style.backgroundColor = '#f0f0f0';
        }
        
        // Aggiorna selezione nella griglia
        document.querySelectorAll('.default-logo-btn').forEach(btn => {
            btn.classList.remove('border-success', 'border-3');
            if (btn.dataset.logoId === logoId) {
                btn.classList.add('border-success', 'border-3');
            }
        });
    }
    
    async function saveTeamInfo() {
        const teamName = document.getElementById('team_name').value.trim();
        const coachName = document.getElementById('coach_name').value.trim();
        const saveButton = document.querySelector('button[onclick="saveTeamInfo()"]');
        const saveButtonText = document.getElementById('saveButtonText');
        
        if (!teamName || !coachName) {
            showToast('Nome squadra e nome allenatore sono obbligatori', 'error');
            return;
        }
        
        try {
            saveButton.disabled = true;
            saveButtonText.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Salvataggio...';
            
            const response = await makeAPICall(`/api.php/leagues/${leagueId}/team-info`, 'PUT', {
                team_name: teamName,
                coach_name: coachName
            });
            
            const data = await response.json();
            
            if (response.ok) {
                saveButtonText.innerHTML = '<i class="bi bi-check-circle me-1"></i> Salvato';
                saveButton.classList.remove('btn-primary');
                saveButton.classList.add('btn-success');
                showToast('Informazioni squadra aggiornate con successo', 'success');
                
                setTimeout(() => {
                    saveButtonText.innerHTML = '<i class="bi bi-check-circle me-1"></i> Salva';
                    saveButton.classList.remove('btn-success');
                    saveButton.classList.add('btn-primary');
                }, 2000);
            } else {
                showToast(data.message || 'Errore nel salvataggio', 'error');
                saveButtonText.innerHTML = '<i class="bi bi-check-circle me-1"></i> Salva';
            }
        } catch (error) {
            console.error('Error:', error);
            showToast('Errore di connessione', 'error');
            saveButtonText.innerHTML = '<i class="bi bi-check-circle me-1"></i> Salva';
        } finally {
            saveButton.disabled = false;
        }
    }
    </script>
</body>
</html> 
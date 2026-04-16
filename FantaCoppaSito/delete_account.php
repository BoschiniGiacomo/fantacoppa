<?php
require_once 'functions.php';
require_once 'config.php';

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$error = '';
$success = '';
$tokenFromGet = trim((string)($_GET['token'] ?? ''));
$showFinalConfirm = false;
$pendingUser = null;

function fc_get_base_url() {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $basePath = rtrim(str_replace('\\', '/', dirname($_SERVER['PHP_SELF'] ?? '/')), '/');
    if ($basePath === '' || $basePath === '.') {
        $basePath = '';
    }
    return $scheme . '://' . $host . $basePath;
}

function fc_table_exists($conn, $tableName) {
    $stmt = $conn->prepare("SHOW TABLES LIKE ?");
    if (!$stmt) {
        return false;
    }
    $stmt->bind_param("s", $tableName);
    $stmt->execute();
    $res = $stmt->get_result();
    $exists = $res && $res->num_rows > 0;
    $stmt->close();
    return $exists;
}

function fc_ensure_deletion_table($conn) {
    $sql = "
        CREATE TABLE IF NOT EXISTS account_deletion_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            email VARCHAR(255) NOT NULL,
            token VARCHAR(128) NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            used TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            requested_ip VARCHAR(64) NULL,
            confirmed_at DATETIME NULL,
            INDEX idx_adr_user_id (user_id),
            INDEX idx_adr_email (email),
            INDEX idx_adr_token (token)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    return $conn->query($sql) === true;
}

function fc_generate_deletion_token($userId, $email) {
    $conn = getDbConnection();
    if (!fc_ensure_deletion_table($conn)) {
        return false;
    }

    $token = bin2hex(random_bytes(32));
    $expiresAt = date('Y-m-d H:i:s', strtotime('+1 hour'));
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';

    // Invalida richieste precedenti aperte per lo stesso account
    $stmt = $conn->prepare("UPDATE account_deletion_requests SET used = 1 WHERE user_id = ? AND used = 0");
    if ($stmt) {
        $stmt->bind_param("i", $userId);
        $stmt->execute();
        $stmt->close();
    }

    $ins = $conn->prepare("INSERT INTO account_deletion_requests (user_id, email, token, expires_at, requested_ip) VALUES (?, ?, ?, ?, ?)");
    if (!$ins) {
        return false;
    }
    $ins->bind_param("issss", $userId, $email, $token, $expiresAt, $ip);
    $ok = $ins->execute();
    $ins->close();

    return $ok ? $token : false;
}

function fc_verify_deletion_token($token) {
    if ($token === '') {
        return false;
    }
    $conn = getDbConnection();
    if (!fc_ensure_deletion_table($conn)) {
        return false;
    }
    $stmt = $conn->prepare("
        SELECT adr.id, adr.user_id, adr.email, adr.expires_at, adr.used, u.username
        FROM account_deletion_requests adr
        LEFT JOIN users u ON u.id = adr.user_id
        WHERE adr.token = ?
        LIMIT 1
    ");
    if (!$stmt) {
        return false;
    }
    $stmt->bind_param("s", $token);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row) return false;
    if ((int)$row['used'] === 1) return false;
    if (strtotime($row['expires_at']) < time()) return false;
    if (empty($row['username'])) return false; // account gia cancellato
    return $row;
}

function fc_send_deletion_email($email, $username, $token) {
    $baseUrl = fc_get_base_url();
    $confirmUrl = $baseUrl . '/delete_account.php?token=' . urlencode($token);
    $subject = 'Conferma eliminazione account - FantaCoppa';
    $body = "
    <html>
    <head><title>Conferma eliminazione account</title></head>
    <body>
        <h2>Richiesta eliminazione account</h2>
        <p>Ciao " . htmlspecialchars($username) . ",</p>
        <p>Abbiamo ricevuto una richiesta di eliminazione definitiva del tuo account FantaCoppa.</p>
        <p>Per confermare, clicca sul link seguente:</p>
        <p><a href='" . htmlspecialchars($confirmUrl) . "'>Conferma eliminazione account</a></p>
        <p>Il link scade tra 1 ora.</p>
        <p>Se non hai fatto tu questa richiesta, ignora questa email: il tuo account non verra eliminato.</p>
        <br>
        <p>Team FantaCoppa</p>
    </body>
    </html>";

    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "Content-type:text/html;charset=UTF-8\r\n";
    $headers .= "From: " . SMTP_FROM_NAME . " <" . SMTP_USERNAME . ">\r\n";
    $headers .= "Reply-To: " . SMTP_USERNAME . "\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    if (function_exists('mail') && @mail($email, $subject, $body, $headers)) {
        return true;
    }

    if (class_exists('PHPMailer\PHPMailer\PHPMailer')) {
        try {
            $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
            $mail->isSMTP();
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
            $mail->setFrom(SMTP_USERNAME, SMTP_FROM_NAME);
            $mail->addAddress($email);
            $mail->isHTML(true);
            $mail->Subject = $subject;
            $mail->Body = $body;
            return $mail->send();
        } catch (Exception $e) {
            error_log("Deletion email error: " . $e->getMessage());
        }
    }

    return false;
}

function fc_delete_user_account($userId, $email) {
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
            'superuser_actions'
        ];

        foreach ($tablesWithUserId as $table) {
            if (!fc_table_exists($conn, $table)) {
                continue;
            }
            if ($table === 'superuser_actions') {
                $stmt = $conn->prepare("DELETE FROM superuser_actions WHERE superuser_id = ? OR target_user_id = ?");
                $stmt->bind_param("ii", $userId, $userId);
            } else {
                $stmt = $conn->prepare("DELETE FROM {$table} WHERE user_id = ?");
                $stmt->bind_param("i", $userId);
            }
            if (!$stmt->execute()) {
                throw new Exception("Delete failed on {$table}: " . $stmt->error);
            }
            $stmt->close();
        }

        if (fc_table_exists($conn, 'password_resets')) {
            $stmt = $conn->prepare("DELETE FROM password_resets WHERE email = ?");
            $stmt->bind_param("s", $email);
            if (!$stmt->execute()) {
                throw new Exception("Delete failed on password_resets: " . $stmt->error);
            }
            $stmt->close();
        }

        if (fc_table_exists($conn, 'account_deletion_requests')) {
            $stmt = $conn->prepare("UPDATE account_deletion_requests SET used = 1, confirmed_at = NOW() WHERE user_id = ?");
            $stmt->bind_param("i", $userId);
            if (!$stmt->execute()) {
                throw new Exception("Update failed on account_deletion_requests: " . $stmt->error);
            }
            $stmt->close();
        }

        $stmt = $conn->prepare("DELETE FROM users WHERE id = ?");
        $stmt->bind_param("i", $userId);
        if (!$stmt->execute()) {
            throw new Exception("Delete failed on users: " . $stmt->error);
        }
        if ($stmt->affected_rows < 1) {
            throw new Exception("User not found during delete");
        }
        $stmt->close();

        $conn->commit();
        return true;
    } catch (Exception $e) {
        $conn->rollback();
        error_log("Account deletion rollback: " . $e->getMessage());
        return false;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    if ($action === 'request') {
        $email = trim((string)($_POST['email'] ?? ''));
        $username = trim((string)($_POST['username'] ?? ''));

        if ($email === '' || $username === '') {
            $error = 'Compila email e username.';
        } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $error = 'Inserisci un indirizzo email valido.';
        } else {
            $conn = getDbConnection();
            $stmt = $conn->prepare("SELECT id, username, email FROM users WHERE email = ? AND username = ? LIMIT 1");
            $stmt->bind_param("ss", $email, $username);
            $stmt->execute();
            $user = $stmt->get_result()->fetch_assoc();
            $stmt->close();

            // Risposta sempre generica per non esporre quali account esistono.
            $success = 'Se i dati inseriti corrispondono a un account, riceverai una mail di conferma eliminazione.';

            if ($user) {
                $token = fc_generate_deletion_token((int)$user['id'], $user['email']);
                if ($token) {
                    fc_send_deletion_email($user['email'], $user['username'], $token);
                }
            }
        }
    } elseif ($action === 'confirm') {
        $token = trim((string)($_POST['token'] ?? ''));
        $verified = fc_verify_deletion_token($token);
        if (!$verified) {
            $error = 'Token non valido, scaduto o gia usato.';
        } else {
            $deleted = fc_delete_user_account((int)$verified['user_id'], $verified['email']);
            if ($deleted) {
                $success = 'Account eliminato con successo. Tutti i dati collegati sono stati rimossi.';
                if (isset($_SESSION['user_id']) && (int)$_SESSION['user_id'] === (int)$verified['user_id']) {
                    session_unset();
                    session_destroy();
                }
                $tokenFromGet = '';
            } else {
                $error = 'Errore durante l\'eliminazione dell\'account. Riprova piu tardi.';
            }
        }
    }
}

if ($tokenFromGet !== '') {
    $pendingUser = fc_verify_deletion_token($tokenFromGet);
    if ($pendingUser) {
        $showFinalConfirm = true;
    } elseif ($error === '') {
        $error = 'Link non valido o scaduto.';
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Eliminazione Account - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
</head>
<body class="bg-light fc-auth-page">
    <div class="container fc-auth-shell" style="max-width: 760px;">
        <div class="row justify-content-center">
            <div class="col-12">
                <div class="card fc-auth-card">
                    <div class="card-body">
                        <h1 class="h4 mb-3">Richiesta eliminazione account</h1>
                        <p class="text-muted mb-4">
                            Per motivi di sicurezza, l'eliminazione avviene solo dopo conferma via email.
                            Inserisci email e username dell'account da eliminare.
                        </p>

                        <?php if ($error): ?>
                            <div class="alert alert-danger"><?php echo htmlspecialchars($error); ?></div>
                        <?php endif; ?>
                        <?php if ($success): ?>
                            <div class="alert alert-success"><?php echo htmlspecialchars($success); ?></div>
                        <?php endif; ?>

                        <?php if ($showFinalConfirm && $pendingUser): ?>
                            <div class="alert alert-warning">
                                <strong>Conferma finale richiesta.</strong><br>
                                Stai per eliminare definitivamente l'account <strong><?php echo htmlspecialchars($pendingUser['username']); ?></strong>
                                (<?php echo htmlspecialchars($pendingUser['email']); ?>) e tutti i dati collegati.
                            </div>
                            <form method="POST">
                                <input type="hidden" name="action" value="confirm">
                                <input type="hidden" name="token" value="<?php echo htmlspecialchars($tokenFromGet); ?>">
                                <button type="submit" class="btn btn-danger">
                                    <i class="bi bi-trash"></i> Conferma eliminazione definitiva
                                </button>
                            </form>
                        <?php else: ?>
                            <form method="POST">
                                <input type="hidden" name="action" value="request">
                                <div class="mb-3">
                                    <label class="form-label" for="email">Email account</label>
                                    <input class="form-control" type="email" id="email" name="email" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label" for="username">Username account</label>
                                    <input class="form-control" type="text" id="username" name="username" required>
                                </div>
                                <button type="submit" class="btn btn-primary">
                                    <i class="bi bi-envelope"></i> Invia mail di conferma
                                </button>
                            </form>
                        <?php endif; ?>

                        <hr class="my-4">
                        <p class="small text-muted mb-0">
                            <a href="index.php" class="text-decoration-none">Torna al login</a>
                            &nbsp;|&nbsp;
                            <a href="privacy-policy.php" class="text-decoration-none">Privacy Policy</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>

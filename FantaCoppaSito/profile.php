<?php
require_once 'functions.php';
startSession();

if (!isLoggedIn()) {
    header('Location: index.php');
    exit();
}

$conn = getDbConnection();
$userId = getCurrentUserId();

// Recupera dati attuali utente
$stmt = $conn->prepare("SELECT username FROM users WHERE id = ?");
$stmt->bind_param("i", $userId);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();

$error = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Modifica username
    if (isset($_POST['action']) && $_POST['action'] === 'change_username') {
        $newUsername = trim($_POST['new_username'] ?? '');
        $password = $_POST['password_confirm'] ?? '';
        if ($newUsername === '' || $password === '') {
            $error = 'Compila tutti i campi.';
        } elseif ($newUsername === $user['username']) {
            $error = 'Il nuovo username è uguale a quello attuale.';
        } else {
            // Verifica password
            $stmt = $conn->prepare("SELECT password FROM users WHERE id = ?");
            $stmt->bind_param("i", $userId);
            $stmt->execute();
            $res = $stmt->get_result();
            if ($row = $res->fetch_assoc()) {
                if (password_verify($password, $row['password'])) {
                    // Aggiorna username
                    $stmt = $conn->prepare("UPDATE users SET username = ? WHERE id = ?");
                    $stmt->bind_param("si", $newUsername, $userId);
                    if ($stmt->execute()) {
                        $_SESSION['username'] = $newUsername;
                        $success = 'Username aggiornato con successo!';
                        $user['username'] = $newUsername;
                    } else {
                        $error = 'Errore durante l\'aggiornamento.';
                    }
                } else {
                    $error = 'Password errata.';
                }
            }
        }
    }
    // Modifica password
    if (isset($_POST['action']) && $_POST['action'] === 'change_password') {
        $currentPassword = $_POST['current_password'] ?? '';
        $newPassword = $_POST['new_password'] ?? '';
        $confirmPassword = $_POST['confirm_password'] ?? '';
        if ($currentPassword === '' || $newPassword === '' || $confirmPassword === '') {
            $error = 'Compila tutti i campi.';
        } elseif ($newPassword !== $confirmPassword) {
            $error = 'Le nuove password non coincidono.';
        } elseif (strlen($newPassword) < 6) {
            $error = 'La nuova password deve essere di almeno 6 caratteri.';
        } else {
            // Verifica password attuale
            $stmt = $conn->prepare("SELECT password FROM users WHERE id = ?");
            $stmt->bind_param("i", $userId);
            $stmt->execute();
            $res = $stmt->get_result();
            if ($row = $res->fetch_assoc()) {
                if (password_verify($currentPassword, $row['password'])) {
                    // Aggiorna password
                    $hashed = password_hash($newPassword, PASSWORD_DEFAULT);
                    $stmt = $conn->prepare("UPDATE users SET password = ? WHERE id = ?");
                    $stmt->bind_param("si", $hashed, $userId);
                    if ($stmt->execute()) {
                        $success = 'Password aggiornata con successo!';
                    } else {
                        $error = 'Errore durante l\'aggiornamento.';
                    }
                } else {
                    $error = 'Password attuale errata.';
                }
            }
        }
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Modifica Profilo - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
</head>
<body class="bg-light fc-settings-page">
    <?php include 'navbar.php'; ?>
    <div class="container fc-page-container">
        <div class="fc-settings-header">
            <h4 class="mb-0 fw-bold text-dark"><i class="bi bi-person-gear me-2 text-primary"></i>Modifica Profilo</h4>
        </div>
        <div class="row justify-content-center">
            <div class="col-md-7 col-lg-6">
                <div class="card fc-settings-card">
                    <div class="card-header bg-primary text-white">
                        <i class="bi bi-person-gear"></i> Modifica Profilo
                    </div>
                    <div class="card-body">
                        <?php if ($error): ?>
                            <div class="alert alert-danger"><?php echo htmlspecialchars($error); ?></div>
                        <?php elseif ($success): ?>
                            <div class="alert alert-success"><?php echo htmlspecialchars($success); ?></div>
                        <?php endif; ?>
                        <h5 class="mb-3">Modifica Username</h5>
                        <form method="POST" class="mb-4">
                            <input type="hidden" name="action" value="change_username">
                            <div class="mb-3">
                                <label for="new_username" class="form-label">Nuovo username</label>
                                <input type="text" class="form-control" id="new_username" name="new_username" value="<?php echo htmlspecialchars($user['username']); ?>" required>
                            </div>
                            <div class="mb-3">
                                <label for="password_confirm" class="form-label">Conferma con password attuale</label>
                                <input type="password" class="form-control" id="password_confirm" name="password_confirm" required>
                            </div>
                            <button type="submit" class="btn btn-primary"><i class="bi bi-save"></i> Aggiorna Username</button>
                        </form>
                        <hr>
                        <h5 class="mb-3">Modifica Password</h5>
                        <form method="POST">
                            <input type="hidden" name="action" value="change_password">
                            <div class="mb-3">
                                <label for="current_password" class="form-label">Password attuale</label>
                                <input type="password" class="form-control" id="current_password" name="current_password" required>
                            </div>
                            <div class="mb-3">
                                <label for="new_password" class="form-label">Nuova password</label>
                                <input type="password" class="form-control" id="new_password" name="new_password" required>
                            </div>
                            <div class="mb-3">
                                <label for="confirm_password" class="form-label">Conferma nuova password</label>
                                <input type="password" class="form-control" id="confirm_password" name="confirm_password" required>
                            </div>
                            <button type="submit" class="btn btn-primary"><i class="bi bi-key"></i> Aggiorna Password</button>
                        </form>
                        <hr>
                        <h5 class="mb-3 text-danger">Eliminazione account</h5>
                        <p class="text-muted small">
                            Se vuoi eliminare definitivamente il tuo account e i dati collegati, avvia la procedura protetta con conferma via email.
                        </p>
                        <a href="delete_account.php" class="btn btn-outline-danger">
                            <i class="bi bi-trash"></i> Richiedi eliminazione account
                        </a>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html> 
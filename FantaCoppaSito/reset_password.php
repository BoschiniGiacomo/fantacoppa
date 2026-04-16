<?php
require_once 'functions.php';

$error = '';
$success = '';
$token = $_GET['token'] ?? '';

if (empty($token)) {
    header('Location: index.php');
    exit;
}

// Verifica se il token è valido
$email = verifyResetToken($token);
if (!$email) {
    $error = 'Link non valido o scaduto. Richiedi un nuovo link di reset.';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $email) {
    $password = $_POST['password'] ?? '';
    $confirm_password = $_POST['confirm_password'] ?? '';
    
    if (empty($password)) {
        $error = 'Inserisci una nuova password.';
    } elseif (strlen($password) < 6) {
        $error = 'La password deve essere di almeno 6 caratteri.';
    } elseif ($password !== $confirm_password) {
        $error = 'Le password non coincidono.';
    } else {
        // Reimposta la password
        if (resetPassword($token, $password)) {
            $success = 'Password reimpostata con successo! Ora puoi effettuare il login.';
        } else {
            $error = 'Errore durante il reset della password. Riprova.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reimposta Password - FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
</head>
<body class="bg-light fc-auth-page">
    <div class="container fc-auth-shell">
        <div class="row justify-content-center">
            <div class="col-12">
                <div class="card fc-auth-card">
                    <div class="card-body">
                        <div class="fc-auth-layout">
                            <div class="fc-auth-brand">
                                <div class="fc-auth-logo">
                                    <i class="bi bi-shield-lock-fill"></i>
                                    <p class="fc-auth-logo-title">NUOVA PASSWORD</p>
                                    <p class="fc-auth-logo-subtitle">FANTACOPPA</p>
                                </div>
                            </div>
                            <div class="fc-auth-panel">
                                <div class="fc-auth-view">
                                    <?php if ($error): ?>
                                        <div class="alert alert-danger"><?php echo htmlspecialchars($error); ?></div>
                                    <?php endif; ?>
                                    
                                    <?php if ($success): ?>
                                        <div class="alert alert-success">
                                            <?php echo htmlspecialchars($success); ?>
                                            <br><br>
                                            <a href="index.php" class="btn btn-primary">Vai al Login</a>
                                        </div>
                                    <?php else: ?>
                                        <?php if ($email): ?>
                                            <p class="text-muted mb-4">
                                                Inserisci la tua nuova password per l'account associato a: <strong><?php echo htmlspecialchars($email); ?></strong>
                                            </p>
                                            
                                            <form method="POST">
                                                <div class="mb-3">
                                                    <label for="password" class="form-label">Nuova Password</label>
                                                    <input type="password" class="form-control" id="password" name="password" required
                                                           minlength="6">
                                                    <div class="form-text">La password deve essere di almeno 6 caratteri.</div>
                                                </div>
                                                <div class="mb-3">
                                                    <label for="confirm_password" class="form-label">Conferma Password</label>
                                                    <input type="password" class="form-control" id="confirm_password" name="confirm_password" required>
                                                </div>
                                                <button type="submit" class="btn btn-primary w-100 mb-3">Reimposta Password</button>
                                            </form>
                                        <?php endif; ?>
                                    <?php endif; ?>
                                    
                                    <div class="text-center">
                                        <a href="index.php" class="fc-forgot-link">← Torna al Login</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html> 
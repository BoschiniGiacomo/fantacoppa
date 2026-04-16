<?php
require_once 'functions.php';

$error = '';
$success = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = $_POST['email'] ?? '';
    
    if (empty($email)) {
        $error = 'Inserisci la tua email.';
    } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'Inserisci un indirizzo email valido.';
    } else {
        // TEMPORANEAMENTE DISABILITATO - Funzionalità disponibile solo dall'app mobile
        // Per sicurezza, non riveliamo se l'email esiste o meno
        $success = 'Per reimpostare la password, usa la funzionalità "Password dimenticata" dall\'app mobile FantaCoppa.';
        
        /* CODICE COMMENTATO - DA REATTIVARE IN FUTURO
        // Genera token di reset
        $token = generateResetToken($email);
        
        // Debug: scrivi nel log anche qui per verificare che la funzione venga chiamata
        $debugLogFile = __DIR__ . '/email_debug.log';
        @file_put_contents($debugLogFile, "[" . date('Y-m-d H:i:s') . "] forgot_password.php: Token generato: " . ($token ? 'SÌ' : 'NO') . "\n", FILE_APPEND | LOCK_EX);
        
        if ($token) {
            // Debug: log prima di chiamare sendResetEmail
            @file_put_contents($debugLogFile, "[" . date('Y-m-d H:i:s') . "] forgot_password.php: Chiamata sendResetEmail() per email: $email\n", FILE_APPEND | LOCK_EX);
            
            // Invia email
            $emailSent = sendResetEmail($email, $token);
            
            // Debug: log dopo la chiamata
            @file_put_contents($debugLogFile, "[" . date('Y-m-d H:i:s') . "] forgot_password.php: sendResetEmail() restituito: " . ($emailSent ? 'TRUE' : 'FALSE') . "\n", FILE_APPEND | LOCK_EX);
            
            if ($emailSent) {
                $success = 'Ti abbiamo inviato un link per reimpostare la password. Controlla la tua email.';
            } else {
                // Mostra link ai log di debug se disponibile
                $debugLogPath = __DIR__ . '/email_debug.log';
                $debugInfo = '';
                if (file_exists($debugLogPath)) {
                    $debugInfo = '<br><br><small>Per maggiori dettagli, controlla <a href="view_email_log.php" target="_blank">i log di debug</a></small>';
                }
                $error = 'Errore nell\'invio dell\'email. Riprova più tardi.' . $debugInfo;
            }
        } else {
            // Per sicurezza, non riveliamo se l'email esiste o meno
            $success = 'Se l\'email è registrata nel nostro sistema, riceverai un link per reimpostare la password.';
        }
        */
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Dimenticata - FantaCoppa</title>
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
                                    <i class="bi bi-key-fill"></i>
                                    <p class="fc-auth-logo-title">RESET PASSWORD</p>
                                    <p class="fc-auth-logo-subtitle">FANTACOPPA</p>
                                </div>
                            </div>
                            <div class="fc-auth-panel">
                                <div class="fc-auth-view">
                                    <?php if ($error): ?>
                                        <div class="alert alert-danger"><?php echo htmlspecialchars($error); ?></div>
                                    <?php endif; ?>
                                    
                                    <?php if ($success): ?>
                                        <div class="alert alert-success"><?php echo htmlspecialchars($success); ?></div>
                                    <?php endif; ?>
                                    
                                    <p class="text-muted mb-4">
                                        Inserisci la tua email e ti invieremo un link per reimpostare la password.
                                    </p>
                                    
                                    <form method="POST">
                                        <div class="mb-3">
                                            <label for="email" class="form-label">Email</label>
                                            <input type="email" class="form-control" id="email" name="email" required
                                                   value="<?php echo htmlspecialchars($_POST['email'] ?? ''); ?>">
                                        </div>
                                        <button type="submit" class="btn btn-primary w-100 mb-3">Invia Link Reset</button>
                                    </form>
                                    
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
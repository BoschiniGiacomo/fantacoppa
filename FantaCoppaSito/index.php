<?php
require_once 'functions.php';

$error = '';
$success = '';
$authView = (isset($_GET['view']) && $_GET['view'] === 'register') ? 'register' : 'login';

// Gestione logout
if (isset($_GET['logout'])) {
    session_start();
    session_destroy();
    $success = 'Logout effettuato con successo.';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action'])) {
        if ($_POST['action'] === 'login') {
            $username = $_POST['username'] ?? '';
            $password = $_POST['password'] ?? '';
            
            if (loginUser($username, $password)) {
                header('Location: dashboard.php');
                exit;
            } else {
                $error = 'Username o password non validi.';
                $authView = 'login';
            }
        } elseif ($_POST['action'] === 'register') {
            $username = $_POST['username'] ?? '';
            $email = $_POST['email'] ?? '';
            $password = $_POST['password'] ?? '';
            
            if (registerUser($username, $email, $password)) {
                // Stesso flusso del login: sessione PHP attiva subito (evita stato "sembro registrato ma non posso usare il sito")
                if (loginUser($username, $password)) {
                    header('Location: dashboard.php');
                    exit;
                }
                $success = 'Registrazione completata. Ora puoi accedere.';
                $authView = 'login';
            } else {
                $error = 'Registrazione non riuscita. Username o email potrebbero essere gia in uso.';
                $authView = 'register';
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
    <title>FantaCoppa - Login</title>
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
                                    <i class="bi bi-dribbble"></i>
                                    <p class="fc-auth-logo-title">FANTA</p>
                                    <p class="fc-auth-logo-title fc-auth-logo-title-tight">
                                        CO<span class="fc-auth-logo-mirror">P</span>PA
                                    </p>
                                    <p class="fc-auth-logo-subtitle">MONTECAVOLO</p>
                                </div>
                            </div>

                            <div class="fc-auth-panel">
                                <?php if ($error): ?>
                                    <div class="alert alert-danger"><?php echo htmlspecialchars($error); ?></div>
                                <?php endif; ?>
                                
                                <?php if ($success): ?>
                                    <div class="alert alert-success"><?php echo htmlspecialchars($success); ?></div>
                                <?php endif; ?>

                                <div id="loginView" class="fc-auth-view <?php echo $authView === 'register' ? 'd-none' : ''; ?>">
                                    <form method="POST">
                                        <input type="hidden" name="action" value="login">
                                        <div class="mb-3">
                                            <label for="username" class="form-label visually-hidden">Username</label>
                                            <div class="fc-auth-input-wrap">
                                                <i class="bi bi-person fc-auth-input-icon"></i>
                                                <input type="text" class="form-control" id="username" name="username" required placeholder="Username" value="<?php echo htmlspecialchars($_POST['username'] ?? ''); ?>">
                                            </div>
                                        </div>
                                        <div class="mb-3">
                                            <label for="password" class="form-label visually-hidden">Password</label>
                                            <div class="fc-auth-input-wrap">
                                                <i class="bi bi-lock fc-auth-input-icon"></i>
                                                <input type="password" class="form-control" id="password" name="password" required placeholder="Password">
                                                <button type="button" class="fc-password-toggle" id="toggleLoginPassword" aria-label="Mostra o nascondi password">
                                                    <i class="bi bi-eye-slash"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <button type="submit" class="btn btn-primary w-100 mb-2">Accedi</button>
                                        <div class="text-center">
                                            <a href="forgot_password.php" class="fc-forgot-link">Password dimenticata?</a>
                                        </div>
                                        <div class="text-center mt-3">
                                            <span class="text-muted">Non hai un account? </span>
                                            <button type="button" class="btn btn-link p-0 fc-auth-switch" data-auth-target="register">Registrati</button>
                                        </div>
                                    </form>
                                </div>

                                <div id="registerView" class="fc-auth-view <?php echo $authView === 'register' ? '' : 'd-none'; ?>">
                                    <div class="fc-auth-register-header">
                                        <i class="bi bi-person-plus"></i>
                                        <h3 class="fc-auth-register-title">Crea Account</h3>
                                        <p class="fc-auth-register-subtitle">Unisciti a FantaCoppa</p>
                                    </div>
                                    <form method="POST">
                                        <input type="hidden" name="action" value="register">
                                        <div class="mb-3">
                                            <label for="reg-username" class="form-label visually-hidden">Username</label>
                                            <div class="fc-auth-input-wrap">
                                                <i class="bi bi-person fc-auth-input-icon"></i>
                                                <input type="text" class="form-control" id="reg-username" name="username" required placeholder="Username" value="<?php echo htmlspecialchars($_POST['username'] ?? ''); ?>">
                                            </div>
                                        </div>
                                        <div class="mb-3">
                                            <label for="reg-email" class="form-label visually-hidden">Email</label>
                                            <div class="fc-auth-input-wrap">
                                                <i class="bi bi-envelope fc-auth-input-icon"></i>
                                                <input type="email" class="form-control" id="reg-email" name="email" required placeholder="Email" value="<?php echo htmlspecialchars($_POST['email'] ?? ''); ?>">
                                            </div>
                                        </div>
                                        <div class="mb-3">
                                            <label for="reg-password" class="form-label visually-hidden">Password</label>
                                            <div class="fc-auth-input-wrap">
                                                <i class="bi bi-lock fc-auth-input-icon"></i>
                                                <input type="password" class="form-control" id="reg-password" name="password" required placeholder="Password">
                                            </div>
                                        </div>
                                        <button type="submit" class="btn btn-primary w-100">Registrati</button>
                                        <div class="text-center mt-3">
                                            <span class="text-muted">Hai già un account? </span>
                                            <button type="button" class="btn btn-link p-0 fc-auth-switch" data-auth-target="login">Accedi</button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                    </div>
                </div>
            </div>
        </div>
        <p class="text-center small text-muted mt-3 mb-0"><a href="privacy-policy.php" class="text-decoration-none">Privacy Policy</a></p>
    </div>
    
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
    document.addEventListener('DOMContentLoaded', function () {
        const loginView = document.getElementById('loginView');
        const registerView = document.getElementById('registerView');
        const passwordInput = document.getElementById('password');
        const passwordToggle = document.getElementById('toggleLoginPassword');
        document.querySelectorAll('.fc-auth-switch').forEach(function (button) {
            button.addEventListener('click', function () {
                const target = this.getAttribute('data-auth-target');
                const showRegister = target === 'register';
                loginView.classList.toggle('d-none', showRegister);
                registerView.classList.toggle('d-none', !showRegister);
            });
        });
        if (passwordToggle && passwordInput) {
            passwordToggle.addEventListener('click', function () {
                const show = passwordInput.type === 'password';
                passwordInput.type = show ? 'text' : 'password';
                this.innerHTML = `<i class="bi ${show ? 'bi-eye' : 'bi-eye-slash'}"></i>`;
            });
        }
    });
    </script>
</body>
</html> 
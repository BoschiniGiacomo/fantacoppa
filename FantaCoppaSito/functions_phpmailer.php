<?php
// Versione alternativa delle funzioni email con PHPMailer
// Usa questo file se hai problemi con la configurazione SMTP di base

// Funzione per inviare email di reset con PHPMailer
function sendResetEmailWithPHPMailer($email, $token) {
    // Configurazione SMTP (modifica con le tue credenziali)
    $smtp_config = [
        'host' => 'smtp.gmail.com',        // Cambia con il tuo provider SMTP
        'port' => 587,                     // Porta SMTP
        'username' => 'tuaemail@gmail.com', // La tua email
        'password' => 'password_app',      // Password per app (Gmail) o password normale
        'from_email' => 'noreply@fantacoppa.com',
        'from_name' => 'FantaCoppa'
    ];
    
    // Se PHPMailer non è installato, usa la funzione di fallback
    if (!class_exists('PHPMailer\PHPMailer\PHPMailer')) {
        return sendResetEmailFallback($email, $token);
    }
    
    try {
        $mail = new PHPMailer\PHPMailer\PHPMailer(true);
        
        // Configurazione server
        $mail->isSMTP();
        $mail->Host = $smtp_config['host'];
        $mail->SMTPAuth = true;
        $mail->Username = $smtp_config['username'];
        $mail->Password = $smtp_config['password'];
        $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port = $smtp_config['port'];
        
        // Configurazione mittente e destinatario
        $mail->setFrom($smtp_config['from_email'], $smtp_config['from_name']);
        $mail->addAddress($email);
        
        // Contenuto email
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
        
        $mail->send();
        return true;
        
    } catch (Exception $e) {
        error_log("Errore PHPMailer: " . $mail->ErrorInfo);
        return false;
    }
}

// Funzione di fallback che simula l'invio email (per test)
function sendResetEmailFallback($email, $token) {
    // Per test locali, salva il link in un file di log
    $resetUrl = "http://" . $_SERVER['HTTP_HOST'] . dirname($_SERVER['PHP_SELF']) . "/reset_password.php?token=" . $token;
    
    $logMessage = date('Y-m-d H:i:s') . " - Reset password richiesto per: $email\n";
    $logMessage .= "Link di reset: $resetUrl\n";
    $logMessage .= "----------------------------------------\n";
    
    file_put_contents('email_log.txt', $logMessage, FILE_APPEND);
    
    // In un ambiente di produzione, dovresti sempre usare un vero server SMTP
    return true; // Simula successo per test
}

// Funzione per testare la configurazione email
function testEmailConfiguration() {
    $test_email = "test@example.com"; // Cambia con la tua email
    
    if (class_exists('PHPMailer\PHPMailer\PHPMailer')) {
        echo "✅ PHPMailer disponibile<br>";
        return sendResetEmailWithPHPMailer($test_email, "test_token");
    } else {
        echo "⚠️ PHPMailer non disponibile, usando fallback<br>";
        return sendResetEmailFallback($test_email, "test_token");
    }
}

// Istruzioni per installare PHPMailer
function getPHPMailerInstallInstructions() {
    return "
    <h3>Installazione PHPMailer</h3>
    <p>Per installare PHPMailer, esegui questi comandi nel terminale:</p>
    <ol>
        <li><code>composer init</code> (se non hai composer.json)</li>
        <li><code>composer require phpmailer/phpmailer</code></li>
        <li>Aggiungi <code>require 'vendor/autoload.php';</code> all'inizio di functions.php</li>
    </ol>
    <p>Oppure scarica manualmente da: <a href='https://github.com/PHPMailer/PHPMailer' target='_blank'>GitHub PHPMailer</a></p>
    ";
}
?>

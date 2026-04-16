<?php
require_once 'functions.php';

echo "<h2>🧪 Test PHPMailer - FantaCoppa</h2>";

// Verifica se PHPMailer è installato correttamente
echo "<h3>1. Verifica Installazione PHPMailer</h3>";

if (class_exists('PHPMailer\PHPMailer\PHPMailer')) {
    echo "✅ PHPMailer installato correttamente<br>";
} else {
    echo "❌ PHPMailer non trovato<br>";
    echo "<p>Verifica che i file siano nella cartella PHPMailer/</p>";
    exit;
}

// Test configurazione
echo "<h3>2. Test Configurazione</h3>";

try {
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    echo "✅ Istanza PHPMailer creata con successo<br>";
    
    // Configurazione di test
    $mail->isSMTP();
    $mail->Host = 'smtp.gmail.com';
    $mail->SMTPAuth = true;
    $mail->Username = 'tuaemail@gmail.com'; // Cambia con la tua email
    $mail->Password = 'password_app_gmail'; // Cambia con la password per app
    $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port = 587;
    
    echo "✅ Configurazione SMTP impostata<br>";
    
} catch (Exception $e) {
    echo "❌ Errore nella configurazione: " . $e->getMessage() . "<br>";
}

// Test invio email
echo "<h3>3. Test Invio Email</h3>";

$test_email = "test@example.com"; // Cambia con la tua email per test reali

try {
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    
    // Configurazione server
    $mail->isSMTP();
    $mail->Host = 'smtp.gmail.com';
    $mail->SMTPAuth = true;
    $mail->Username = 'tuaemail@gmail.com'; // Cambia con la tua email
    $mail->Password = 'password_app_gmail'; // Cambia con la password per app
    $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port = 587;
    
    // Configurazione mittente e destinatario
    $mail->setFrom('noreply@fantacoppa.com', 'FantaCoppa');
    $mail->addAddress($test_email);
    
    // Contenuto email
    $mail->isHTML(true);
    $mail->Subject = 'Test PHPMailer - FantaCoppa';
    
    $mail->Body = "
    <html>
    <head>
        <title>Test PHPMailer</title>
    </head>
    <body>
        <h2>Test PHPMailer - FantaCoppa</h2>
        <p>Questo è un test per verificare che PHPMailer funzioni correttamente.</p>
        <p>Data e ora: " . date('Y-m-d H:i:s') . "</p>
        <p>Se ricevi questa email, la configurazione è corretta!</p>
    </body>
    </html>
    ";
    
    echo "Invio email di test a: $test_email<br>";
    
    $mail->send();
    echo "✅ Email inviata con successo!<br>";
    
} catch (Exception $e) {
    echo "❌ Errore nell'invio: " . $mail->ErrorInfo . "<br>";
    
    echo "<div style='background: #f8d7da; padding: 10px; border: 1px solid #f5c6cb; margin: 10px 0;'>";
    echo "<strong>🔧 Possibili cause:</strong><br>";
    echo "• Credenziali Gmail non corrette<br>";
    echo "• Autenticazione a 2 fattori non attiva<br>";
    echo "• Password per app non generata<br>";
    echo "• Firewall blocca la connessione<br>";
    echo "</div>";
}

// Test funzione sendResetEmail
echo "<h3>4. Test Funzione sendResetEmail</h3>";

$test_token = "test_token_" . time();
$result = sendResetEmail($test_email, $test_token);

if ($result) {
    echo "✅ Funzione sendResetEmail funziona correttamente<br>";
} else {
    echo "❌ Errore nella funzione sendResetEmail<br>";
}

echo "<hr>";
echo "<h3>📋 Prossimi Passi</h3>";
echo "<ol>";
echo "<li>Cambia 'tuaemail@gmail.com' con la tua email Gmail</li>";
echo "<li>Cambia 'password_app_gmail' con la password per app generata</li>";
echo "<li>Cambia 'test@example.com' con la tua email per i test</li>";
echo "<li>Riprova questo test</li>";
echo "</ol>";

echo "<p><a href='INSTALLAZIONE_PHPMailer.md' target='_blank'>📖 Leggi la guida completa</a></p>";
echo "<p><a href='test_email_advanced.php'>← Torna al test avanzato</a></p>";
?>

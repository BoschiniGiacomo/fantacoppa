<?php
// Test avanzato per la configurazione email
echo "<h2>🔧 Diagnostica Email - FantaCoppa</h2>";

// 1. Verifica funzione mail
echo "<h3>1. Verifica Funzione Mail</h3>";
if (function_exists('mail')) {
    echo "✅ Funzione mail() disponibile<br>";
} else {
    echo "❌ Funzione mail() non disponibile<br>";
}

// 2. Verifica configurazione SMTP
echo "<h3>2. Configurazione SMTP Attuale</h3>";
$smtp = ini_get('SMTP');
$smtp_port = ini_get('smtp_port');
$sendmail_from = ini_get('sendmail_from');

echo "<strong>SMTP:</strong> " . ($smtp ?: 'Non configurato') . "<br>";
echo "<strong>Porta SMTP:</strong> " . ($smtp_port ?: 'Non configurato') . "<br>";
echo "<strong>From Email:</strong> " . ($sendmail_from ?: 'Non configurato') . "<br>";

// 3. Test connessione SMTP
echo "<h3>3. Test Connessione SMTP</h3>";
if ($smtp && $smtp !== 'localhost') {
    $connection = @fsockopen($smtp, $smtp_port, $errno, $errstr, 10);
    if ($connection) {
        echo "✅ Connessione a $smtp:$smtp_port riuscita<br>";
        fclose($connection);
    } else {
        echo "❌ Impossibile connettersi a $smtp:$smtp_port<br>";
        echo "Errore: $errstr ($errno)<br>";
    }
} else {
    echo "⚠️ SMTP non configurato o impostato su localhost<br>";
}

// 4. Test invio email
echo "<h3>4. Test Invio Email</h3>";
$test_email = "test@example.com"; // Cambia con la tua email
$subject = "Test Email FantaCoppa - " . date('Y-m-d H:i:s');
$message = "Questo è un test per verificare la configurazione email.";
$headers = "From: noreply@fantacoppa.com";

echo "Invio email di test a: $test_email<br>";

if (mail($test_email, $subject, $message, $headers)) {
    echo "✅ Email inviata con successo!<br>";
} else {
    echo "❌ Errore nell'invio dell'email.<br>";
}

// 5. Soluzioni suggerite
echo "<h3>5. Soluzioni Suggerite</h3>";

if ($smtp === 'localhost' || !$smtp) {
    echo "<div style='background: #fff3cd; padding: 10px; border: 1px solid #ffeaa7; margin: 10px 0;'>";
    echo "<strong>🔧 Problema identificato:</strong> SMTP non configurato correttamente<br>";
    echo "<strong>📝 Soluzione:</strong><br>";
    echo "1. Apri <code>C:\\xampp\\php\\php.ini</code><br>";
    echo "2. Trova la sezione <code>[mail function]</code> (riga 1098)<br>";
    echo "3. Modifica con:<br>";
    echo "<pre style='background: #f8f9fa; padding: 10px;'>";
    echo "[mail function]\n";
    echo "SMTP=smtp.gmail.com\n";
    echo "smtp_port=587\n";
    echo "sendmail_from = tuaemail@gmail.com\n";
    echo "</pre>";
    echo "4. Riavvia Apache dal pannello XAMPP<br>";
    echo "</div>";
}

// 6. Alternative
echo "<h3>6. Alternative per Test</h3>";
echo "<div style='background: #d1ecf1; padding: 10px; border: 1px solid #bee5eb; margin: 10px 0;'>";
echo "<strong>📧 Opzioni per test:</strong><br>";
echo "• <strong>Gmail SMTP:</strong> Gratuito, richiede password per app<br>";
echo "• <strong>Outlook SMTP:</strong> Gratuito, usa smtp-mail.outlook.com:587<br>";
echo "• <strong>Mailtrap.io:</strong> Gratuito per test, cattura tutte le email<br>";
echo "• <strong>PHPMailer:</strong> Libreria PHP per email più avanzata<br>";
echo "</div>";

// 7. Test con PHPMailer se disponibile
echo "<h3>7. Test PHPMailer</h3>";
if (class_exists('PHPMailer\PHPMailer\PHPMailer')) {
    echo "✅ PHPMailer disponibile<br>";
    echo "<a href='test_phpmailer.php' class='btn btn-primary'>Test PHPMailer</a>";
} else {
    echo "⚠️ PHPMailer non installato<br>";
    echo "<div style='background: #f8d7da; padding: 10px; border: 1px solid #f5c6cb; margin: 10px 0;'>";
    echo "<strong>📦 Per installare PHPMailer:</strong><br>";
    echo "1. <code>composer require phpmailer/phpmailer</code><br>";
    echo "2. Aggiungi <code>require 'vendor/autoload.php';</code> in functions.php<br>";
    echo "</div>";
}

// 8. Log degli errori
echo "<h3>8. Log Errori</h3>";
$error_log = ini_get('error_log');
echo "<strong>Error Log:</strong> " . ($error_log ?: 'Non configurato') . "<br>";

if (file_exists('C:\\xampp\\apache\\logs\\error.log')) {
    echo "📄 <a href='view_log.php' target='_blank'>Visualizza Log Apache</a><br>";
}

echo "<hr>";
echo "<h3>📋 Prossimi Passi</h3>";
echo "<ol>";
echo "<li>Configura un provider SMTP (Gmail, Outlook, ecc.)</li>";
echo "<li>Modifica php.ini con le credenziali corrette</li>";
echo "<li>Riavvia Apache</li>";
echo "<li>Riprova questo test</li>";
echo "<li>Se ancora non funziona, considera PHPMailer</li>";
echo "</ol>";

echo "<p><a href='CONFIGURAZIONE_EMAIL.md' target='_blank'>📖 Leggi la guida completa</a></p>";
?>

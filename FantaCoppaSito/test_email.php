<?php
// Test per verificare la configurazione email
echo "<h2>Test Configurazione Email - FantaCoppa</h2>";

// Verifica se la funzione mail è disponibile
if (function_exists('mail')) {
    echo "✅ Funzione mail() disponibile<br>";
} else {
    echo "❌ Funzione mail() non disponibile<br>";
    exit;
}

// Test invio email
$to = "test@example.com"; // Cambia con la tua email per test reali
$subject = "Test Email FantaCoppa - " . date('Y-m-d H:i:s');
$message = "
<html>
<head>
    <title>Test Email FantaCoppa</title>
</head>
<body>
    <h2>Test Configurazione Email</h2>
    <p>Questo è un test per verificare che la configurazione email funzioni correttamente.</p>
    <p>Data e ora: " . date('Y-m-d H:i:s') . "</p>
    <p>Se ricevi questa email, la configurazione è corretta!</p>
</body>
</html>
";

$headers = "MIME-Version: 1.0" . "\r\n";
$headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
$headers .= "From: noreply@fantacoppa.com" . "\r\n";

echo "<p>Invio email di test...</p>";

if (mail($to, $subject, $message, $headers)) {
    echo "✅ Email inviata con successo!<br>";
    echo "📧 Email inviata a: $to<br>";
    echo "📅 Data: " . date('Y-m-d H:i:s') . "<br>";
} else {
    echo "❌ Errore nell'invio dell'email.<br>";
    echo "<p><strong>Possibili cause:</strong></p>";
    echo "<ul>";
    echo "<li>Configurazione SMTP non corretta in php.ini</li>";
    echo "<li>Apache non riavviato dopo la modifica di php.ini</li>";
    echo "<li>Porta 25 bloccata dal firewall</li>";
    echo "<li>Server SMTP non disponibile</li>";
    echo "</ul>";
}

echo "<hr>";
echo "<h3>Informazioni di Debug</h3>";
echo "<strong>PHP Version:</strong> " . phpversion() . "<br>";
echo "<strong>Server Software:</strong> " . $_SERVER['SERVER_SOFTWARE'] . "<br>";
echo "<strong>Document Root:</strong> " . $_SERVER['DOCUMENT_ROOT'] . "<br>";

// Verifica configurazione mail
echo "<h3>Configurazione Mail</h3>";
$mail_config = ini_get_all('mail');
foreach ($mail_config as $key => $value) {
    echo "<strong>$key:</strong> " . $value['local_value'] . "<br>";
}
?> 
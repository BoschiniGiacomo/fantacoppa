<?php
// Visualizza i log di Apache per il debug
$log_file = 'C:\\xampp\\apache\\logs\\error.log';

echo "<h2>📄 Log Apache - FantaCoppa</h2>";

if (file_exists($log_file)) {
    $log_content = file_get_contents($log_file);
    $lines = explode("\n", $log_content);
    
    // Mostra solo le ultime 50 righe
    $recent_lines = array_slice($lines, -50);
    
    echo "<div style='background: #f8f9fa; padding: 15px; border: 1px solid #dee2e6; font-family: monospace; font-size: 12px; max-height: 500px; overflow-y: auto;'>";
    
    foreach ($recent_lines as $line) {
        if (trim($line) !== '') {
            // Evidenzia errori email
            if (strpos($line, 'mail') !== false || strpos($line, 'SMTP') !== false) {
                echo "<div style='background: #fff3cd; padding: 2px; margin: 1px 0;'>" . htmlspecialchars($line) . "</div>";
            } else {
                echo "<div style='padding: 2px; margin: 1px 0;'>" . htmlspecialchars($line) . "</div>";
            }
        }
    }
    
    echo "</div>";
    
    echo "<p><small>Mostrate le ultime 50 righe del log. File completo: $log_file</small></p>";
} else {
    echo "<p>❌ File di log non trovato: $log_file</p>";
}

echo "<p><a href='test_email_advanced.php'>← Torna al test email</a></p>";
?>

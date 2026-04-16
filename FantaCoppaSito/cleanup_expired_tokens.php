<?php
require_once 'db.php';

// Script per pulire i token di reset password scaduti
// Può essere eseguito tramite cron job

try {
    $conn = getDbConnection();
    
    // Elimina i token scaduti
    $stmt = $conn->prepare("DELETE FROM password_resets WHERE expires_at < NOW()");
    $stmt->execute();
    
    $deletedCount = $stmt->affected_rows;
    
    echo "Pulizia completata. Eliminati $deletedCount token scaduti.\n";
    
    $stmt->close();
    $conn->close();
    
} catch (Exception $e) {
    error_log("Errore durante la pulizia dei token: " . $e->getMessage());
    echo "Errore durante la pulizia: " . $e->getMessage() . "\n";
}
?> 
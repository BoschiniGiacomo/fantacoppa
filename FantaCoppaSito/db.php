<?php
// Configurazione database locale (per sviluppo)
// define('DB_HOST', 'localhost');
// define('DB_USER', 'root');
// define('DB_PASS', '');
// define('DB_NAME', 'fantacoppa');

// Configurazione database Altervista (per produzione)
define('DB_HOST', 'localhost');
define('DB_USER', 'fantacoppa');
define('DB_PASS', '');
define('DB_NAME', 'my_fantacoppa');

function getDbConnection() {
    try {
        $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
        
        if ($conn->connect_error) {
            throw new Exception("Connection failed: " . $conn->connect_error);
        }
        
        $conn->set_charset("utf8mb4");
        return $conn;
    } catch (Exception $e) {
        error_log("Database connection error: " . $e->getMessage());
        die("Could not connect to the database. Please try again later.");
    }
}

// Crea la connessione globale
$conn = getDbConnection();

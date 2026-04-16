<?php
require_once 'db.php';

echo "Running Super User migration...\n";

try {
    // Read and execute the migration file
    $migration_sql = file_get_contents('migration_superuser.sql');
    
    // Split by semicolon and execute each statement
    $statements = array_filter(array_map('trim', explode(';', $migration_sql)));
    
    foreach ($statements as $statement) {
        if (!empty($statement) && !preg_match('/^--/', $statement)) {
            echo "Executing: " . substr($statement, 0, 50) . "...\n";
            $conn->query($statement);
        }
    }
    
    echo "Migration completed successfully!\n";
    echo "Super User functionality is now available.\n";
    echo "\nTo make a user a superuser, run this SQL command:\n";
    echo "UPDATE users SET is_superuser = 1 WHERE username = 'your_username';\n";
    
} catch (Exception $e) {
    echo "Migration failed: " . $e->getMessage() . "\n";
}
?>

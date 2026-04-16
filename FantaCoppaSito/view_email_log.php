<?php
// Pagina per visualizzare i log di debug dell'invio email
$logFile = __DIR__ . '/email_debug.log';

// Crea il file se non esiste
if (!file_exists($logFile)) {
    @file_put_contents($logFile, '');
    @chmod($logFile, 0666);
}

// Verifica se il file esiste e può essere letto
if (!file_exists($logFile)) {
    $error = "Impossibile creare il file di log. Verifica i permessi della directory: " . htmlspecialchars(__DIR__);
} elseif (!is_readable($logFile)) {
    $error = "Il file di log esiste ma non è leggibile. Verifica i permessi del file: " . htmlspecialchars($logFile);
} else {
    $error = null;
}

// Leggi gli ultimi 1000 righe del log (se il file esiste e non è vuoto)
$lastLines = [];
if (!$error && filesize($logFile) > 0) {
    $lines = @file($logFile);
    if ($lines !== false) {
        $lastLines = array_slice($lines, -1000);
    }
}

// Formatta le righe per HTML
$formattedLines = array_map(function($line) {
    return htmlspecialchars($line);
}, $lastLines);

// Se c'è un parametro ?clear=1, pulisci il log
if (isset($_GET['clear']) && $_GET['clear'] === '1') {
    file_put_contents($logFile, '');
    header('Location: view_email_log.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Log Debug Email - FantaCoppa</title>
    <style>
        body {
            font-family: 'Courier New', monospace;
            background-color: #1e1e1e;
            color: #d4d4d4;
            padding: 20px;
            margin: 0;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: #252526;
            padding: 20px;
            border-radius: 8px;
        }
        h1 {
            color: #4ec9b0;
            margin-top: 0;
        }
        .controls {
            margin-bottom: 20px;
            padding: 10px;
            background-color: #2d2d30;
            border-radius: 4px;
        }
        .controls a {
            color: #4ec9b0;
            text-decoration: none;
            margin-right: 15px;
            padding: 5px 10px;
            background-color: #3e3e42;
            border-radius: 3px;
            display: inline-block;
        }
        .controls a:hover {
            background-color: #505052;
        }
        .log-content {
            background-color: #1e1e1e;
            padding: 15px;
            border-radius: 4px;
            border: 1px solid #3e3e42;
            max-height: 600px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-size: 13px;
            line-height: 1.5;
        }
        .log-line {
            margin: 2px 0;
        }
        .log-success {
            color: #4ec9b0;
        }
        .log-error {
            color: #f48771;
        }
        .log-info {
            color: #9cdcfe;
        }
        .footer {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #3e3e42;
            color: #858585;
            font-size: 12px;
        }
        .auto-refresh {
            color: #858585;
            font-size: 12px;
            margin-left: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📧 Log Debug Email - FantaCoppa</h1>
        
        <div class="controls">
            <a href="view_email_log.php">🔄 Aggiorna</a>
            <a href="view_email_log.php?clear=1" onclick="return confirm('Vuoi davvero cancellare tutti i log?')">🗑️ Cancella Log</a>
            <a href="forgot_password.php">← Torna a Password Dimenticata</a>
            <span class="auto-refresh">Ultimo aggiornamento: <?php echo date('H:i:s'); ?></span>
        </div>
        
        <div class="log-content" id="logContent">
<?php
if ($error) {
    echo "<div class='log-error'>❌ $error</div>";
} elseif (empty($formattedLines)) {
    echo "<div class='log-info'>📝 Nessun log disponibile. Il file esiste ma è vuoto.</div>";
    echo "<div class='log-info'>💡 Prova a inviare una email di reset password da <a href='forgot_password.php' style='color: #4ec9b0;'>forgot_password.php</a> per generare i log.</div>";
} else {
    foreach ($formattedLines as $line) {
        $class = 'log-line';
        if (strpos($line, 'SUCCESSO') !== false || strpos($line, 'OK') !== false) {
            $class .= ' log-success';
        } elseif (strpos($line, 'ERRORE') !== false || strpos($line, 'ERROR') !== false) {
            $class .= ' log-error';
        } else {
            $class .= ' log-info';
        }
        echo "<div class='$class'>$line</div>";
    }
}
?>
        </div>
        
        <div class="footer">
            <p><strong>File di log:</strong> <?php echo htmlspecialchars($logFile); ?></p>
            <p><strong>File esiste:</strong> <?php echo file_exists($logFile) ? '✅ Sì' : '❌ No'; ?></p>
            <p><strong>File leggibile:</strong> <?php echo (file_exists($logFile) && is_readable($logFile)) ? '✅ Sì' : '❌ No'; ?></p>
            <p><strong>Dimensione file:</strong> <?php echo file_exists($logFile) ? number_format(filesize($logFile)) . ' bytes' : 'N/A'; ?></p>
            <p><strong>Ultima modifica:</strong> <?php echo file_exists($logFile) ? date('Y-m-d H:i:s', filemtime($logFile)) : 'N/A'; ?></p>
            <p><strong>Permessi directory:</strong> <?php echo is_writable(__DIR__) ? '✅ Scrivibile' : '❌ Non scrivibile'; ?></p>
            <p><small>💡 Suggerimento: Questo file mostra gli ultimi 1000 log. Ricarica la pagina per vedere nuovi log dopo aver provato a inviare un'email.</small></p>
        </div>
    </div>
    
    <script>
        // Auto-scroll verso il basso per vedere gli ultimi log
        document.getElementById('logContent').scrollTop = document.getElementById('logContent').scrollHeight;
    </script>
</body>
</html>


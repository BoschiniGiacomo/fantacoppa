# Configurazione Database Altervista

## ⚠️ Importante: Connessioni Esterne

Altervista **NON permette connessioni MySQL esterne** per motivi di sicurezza. Le connessioni MySQL sono permesse solo da:
- Script PHP eseguiti sul server Altervista stesso
- Applicazioni che girano sul server Altervista

## 🔄 Soluzioni Alternative

### Opzione 1: API PHP Intermedia (Consigliata)

Crea un'API PHP sul server Altervista che fa da ponte tra l'app mobile e il database:

1. **Crea un file `api.php` sul server Altervista:**
```php
<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

require_once 'db.php';
require_once 'functions.php';

// Gestisci le richieste
$method = $_SERVER['REQUEST_METHOD'];
$path = $_SERVER['REQUEST_URI'];

// Routing semplice
if ($method === 'POST' && strpos($path, '/api/auth/register') !== false) {
    // Logica registrazione
    $data = json_decode(file_get_contents('php://input'), true);
    // ... implementa registrazione
}
```

2. **Aggiorna l'URL nell'app mobile:**
```javascript
const API_BASE_URL = 'https://tuosito.altervista.org/api';
```

### Opzione 2: Usa il Database Locale

Se hai XAMPP/WAMP locale, usa il database locale come prima:
- Host: `localhost`
- User: `root`
- Password: (vuota)
- Database: `fantacoppa`

### Opzione 3: Database Hosting con Connessioni Esterne

Usa un servizio di hosting che permette connessioni MySQL esterne:
- **PlanetHoster**
- **Hostinger**
- **A2 Hosting**
- **DigitalOcean** (VPS)

## 📝 Configurazione Attuale

Il backend è configurato per Altervista, ma **non funzionerà** a meno che:
- Il backend non sia eseguito sul server Altervista stesso (impossibile con Node.js su Altervista)
- Non usi un'API PHP intermedia

## ✅ Soluzione Consigliata

**Crea un'API PHP sul server Altervista** che:
1. Si connette al database MySQL (funziona perché è sul server stesso)
2. Espone endpoint REST per l'app mobile
3. Gestisce autenticazione JWT o sessioni

Poi aggiorna l'app mobile per usare l'URL del tuo sito Altervista invece di localhost.


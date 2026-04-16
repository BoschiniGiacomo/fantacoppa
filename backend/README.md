# Backend API per FantaCoppa Mobile

Backend Node.js/Express che si connette a PostgreSQL (Supabase).

## 📋 Requisiti

- Node.js (v18 o superiore)
- PostgreSQL (Supabase)
- npm

## 🚀 Installazione

1. **Installa le dipendenze:**
   ```bash
   cd backend
   npm install
   ```

2. **Configura le variabili d'ambiente:**
   
   Crea un file `.env` nella cartella `backend/`:
   ```env
   SUPABASE_DB_URL=postgresql://postgres:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres
   JWT_SECRET=fantacoppa-secret-key-2024-change-in-production
   PORT=3000
   ```

3. **Avvia il server:**
   ```bash
   npm start
   ```
   
   Per sviluppo con auto-reload:
   ```bash
   npm run dev
   ```

## 📡 Endpoint API

### Autenticazione

- `POST /api/auth/register` - Registrazione nuovo utente
- `POST /api/auth/login` - Login utente
- `POST /api/auth/logout` - Logout (solo per invalidare token lato client)
- `GET /api/auth/verify` - Verifica validità token (richiede autenticazione)

### Utility

- `GET /api/health` - Health check del server
- `GET /api/test-db` - Test connessione database

## 🔐 Autenticazione

L'API usa JWT (JSON Web Tokens) per l'autenticazione.

**Header richiesto per endpoint protetti:**
```
Authorization: Bearer <token>
```

## 📝 Esempi

### Registrazione
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"password123"}'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'
```

## 🔧 Configurazione App Mobile

Per usare il backend dall'app mobile:

1. **Per emulatore Android:** usa `http://10.0.2.2:3000/api`
2. **Per dispositivo fisico:** usa `http://<IP_COMPUTER>:3000/api`

Trova l'IP del tuo computer:
- Windows: `ipconfig` → cerca "IPv4 Address"
- Mac/Linux: `ifconfig` o `ip addr`

Poi modifica `src/services/api.js` nell'app mobile:
```javascript
const API_BASE_URL = 'http://192.168.1.100:3000/api'; // Sostituisci con il tuo IP
```

## 🗄️ Database

Il backend si connette al database PostgreSQL su Supabase:
- Database: `postgres` (default Supabase)
- Tabella utenti: `users`
- Connessione tramite stringa `SUPABASE_DB_URL`

## 📚 Prossimi Passi

- [ ] Implementare route per leghe
- [ ] Implementare route per mercato
- [ ] Implementare route per rosa
- [ ] Implementare route per formazioni
- [ ] Aggiungere validazione input più robusta
- [ ] Aggiungere rate limiting
- [ ] Aggiungere logging

# 📱 Istruzioni per FantaCoppa Mobile App

## ✅ Cosa è stato creato

Ho convertito il tuo progetto PHP web in un'applicazione mobile React Native + Expo. Ecco cosa è stato implementato:

### 🎨 Struttura App Mobile

1. **Autenticazione**
   - ✅ Schermata Login
   - ✅ Schermata Registrazione
   - ✅ Context API per gestione stato autenticazione
   - ✅ Salvataggio token in AsyncStorage

2. **Navigazione**
   - ✅ Stack Navigator per Login/Register
   - ✅ Tab Navigator per le schermate principali
   - ✅ Navigazione tra schermate

3. **Schermate Principali**
   - ✅ Dashboard (lista leghe)
   - ✅ Dettagli Lega (classifica, info)
   - ✅ Mercato (acquisto giocatori)
   - ✅ Rosa (squadra personale)
   - ✅ Formazione (lineup)
   - ✅ Profilo utente

4. **Servizi API**
   - ✅ Configurazione base per chiamate API
   - ✅ Interceptors per token JWT
   - ✅ Servizi per: auth, leagues, market, squad, formation

## 🚧 Cosa manca ancora

### 1. Backend API Node.js/Express ⚠️ IMPORTANTE

L'app mobile si connette a un backend API che deve replicare le funzionalità PHP. Devi creare:

**File da creare: `backend/`**
- `server.js` - Server Express principale
- `routes/auth.js` - Endpoint login/register
- `routes/leagues.js` - Endpoint leghe
- `routes/market.js` - Endpoint mercato
- `routes/squad.js` - Endpoint rosa
- `routes/formation.js` - Endpoint formazioni
- `config/database.js` - Connessione MySQL
- `middleware/auth.js` - Middleware JWT
- `package.json` - Dipendenze backend

**Database:**
- Usa lo stesso database MySQL del progetto PHP
- Le tabelle sono già create (vedi `FantaCoppaSito/tables.sql`)

### 2. Configurazione URL API

Modifica `src/services/api.js` con l'URL corretto del tuo backend:

```javascript
// Per sviluppo locale
const API_BASE_URL = 'http://localhost:3000/api';

// Per Android Emulatore
const API_BASE_URL = 'http://10.0.2.2:3000/api';

// Per dispositivo fisico (sostituisci con il tuo IP)
const API_BASE_URL = 'http://192.168.1.100:3000/api';
```

### 3. Funzionalità da completare

- [ ] Sistema di asta in tempo reale (WebSocket/Socket.io)
- [ ] Notifiche push per scadenze
- [ ] Gestione formazioni completa (drag & drop)
- [ ] Calendario giornate
- [ ] Statistiche avanzate

## 📦 Software da installare

### Obbligatori:
1. **Node.js** (v18+) - [nodejs.org](https://nodejs.org/)
2. **npm** (incluso con Node.js)
3. **Expo CLI**: `npm install -g expo-cli`
4. **Expo Go** (app sul telefono) - [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent) / [App Store](https://apps.apple.com/app/expo-go/id982107779)

### Opzionali ma consigliati:
- **Android Studio** (per emulatore Android)
- **Visual Studio Code** con estensioni:
  - React Native Tools
  - ES7+ React/Redux snippets

## 🚀 Come avviare l'app

1. **Installa le dipendenze:**
   ```bash
   npm install
   ```

2. **Avvia Expo:**
   ```bash
   npm start
   # oppure
   expo start
   ```

3. **Sul telefono:**
   - Installa Expo Go
   - Scansiona il QR code mostrato nel terminale

4. **Su emulatore:**
   - Avvia Android Studio emulatore
   - Premi `a` nel terminale Expo

## 🔧 Prossimi passi

### Step 1: Crea il Backend API

Crea una cartella `backend/` e implementa un server Express che:
- Si connette al database MySQL esistente
- Implementa tutti gli endpoint necessari
- Usa JWT per l'autenticazione
- Replica la logica del progetto PHP

### Step 2: Testa la connessione

1. Avvia il backend: `cd backend && npm start`
2. Modifica l'URL API nell'app mobile
3. Testa login/registrazione

### Step 3: Completa le funzionalità

- Implementa il sistema di asta
- Aggiungi notifiche push
- Completa la gestione formazioni

## 📝 Note importanti

- **Database**: L'app usa lo stesso database del progetto PHP, quindi i dati sono condivisi
- **Autenticazione**: Usa JWT invece delle sessioni PHP
- **Real-time**: Per le aste in tempo reale, considera Socket.io o WebSocket
- **Notifiche**: Expo supporta notifiche push native

## 🆘 Problemi comuni

**"Network request failed"**
- Verifica che il backend sia avviato
- Controlla l'URL API in `src/services/api.js`
- Per Android emulatore usa `10.0.2.2` invece di `localhost`

**"Module not found"**
- Esegui `npm install` di nuovo
- Cancella `node_modules` e reinstalla

**App non si connette al backend**
- Verifica firewall/antivirus
- Controlla che il backend sia accessibile dalla rete locale

## 📚 Risorse utili

- [Expo Documentation](https://docs.expo.dev/)
- [React Navigation](https://reactnavigation.org/)
- [React Native Docs](https://reactnative.dev/)

---

**Buon lavoro! 🎉**

Se hai bisogno di aiuto per creare il backend API, posso aiutarti a implementarlo.


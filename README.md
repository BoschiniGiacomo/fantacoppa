# FantaCoppa Mobile App

Applicazione mobile React Native + Expo per FantaCoppa, convertita dal progetto web PHP esistente.

## 📋 Requisiti

Prima di iniziare, assicurati di avere installato:

1. **Node.js** (v18 o superiore) - [Download](https://nodejs.org/)
2. **npm** o **yarn**
3. **Expo CLI** - Installa con: `npm install -g expo-cli`
4. **Android Studio** (per emulatore Android) o **Xcode** (per iOS, solo su Mac)

## 🚀 Installazione

1. **Installa le dipendenze:**
   ```bash
   npm install
   ```

2. **Avvia l'app:**
   ```bash
   npm start
   # oppure
   expo start
   ```

3. **Per Android:**
   - Apri l'emulatore Android o collega un dispositivo
   - Premi `a` nel terminale o scansiona il QR code con Expo Go

4. **Per iOS (solo Mac):**
   - Apri il simulatore iOS
   - Premi `i` nel terminale

## 📱 Struttura Progetto

```
fantacoppa-mobile/
├── App.js                 # Entry point principale
├── app.json              # Configurazione Expo
├── package.json          # Dipendenze
├── src/
│   ├── context/         # Context API (AuthContext)
│   ├── screens/         # Schermate dell'app
│   │   ├── LoginScreen.js
│   │   ├── RegisterScreen.js
│   │   ├── DashboardScreen.js
│   │   ├── LeagueScreen.js
│   │   ├── MarketScreen.js
│   │   ├── SquadScreen.js
│   │   ├── FormationScreen.js
│   │   └── ProfileScreen.js
│   └── services/        # Servizi API
│       └── api.js
└── backend/             # Backend Node.js/Express (da creare)
```

## 🔧 Configurazione Backend

L'app si connette a un backend API Node.js/Express. Per ora, modifica l'URL nel file `src/services/api.js`:

```javascript
const API_BASE_URL = 'http://localhost:3000/api';
```

**Per Android Emulatore:** usa `http://10.0.2.2:3000/api`
**Per dispositivo fisico:** usa l'IP della tua macchina, es. `http://192.168.1.100:3000/api`

## 📝 Funzionalità Implementate

- ✅ Login/Registrazione
- ✅ Dashboard con lista leghe
- ✅ Navigazione con Tab Navigator
- ✅ Context API per autenticazione
- ✅ Servizi API base

## 🚧 Da Implementare

- [ ] Backend API completo (Node.js/Express)
- [ ] Schermata Mercato con asta
- [ ] Schermata Rosa
- [ ] Schermata Formazione
- [ ] Sistema di notifiche push
- [ ] Real-time updates per le aste

## 📚 Prossimi Passi

1. **Crea il backend API** che replichi le funzionalità PHP
2. **Completa le schermate** mancanti
3. **Implementa il sistema di asta** in tempo reale
4. **Aggiungi notifiche push** per scadenze e aste

## 🛠️ Tecnologie Utilizzate

- React Native
- Expo
- React Navigation
- Context API
- Axios
- AsyncStorage

## 📄 Licenza

Questo progetto è parte del sistema FantaCoppa.


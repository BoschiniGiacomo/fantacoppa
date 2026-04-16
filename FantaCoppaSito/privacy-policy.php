<?php
// Pagina informativa privacy — FantaCoppa (app mobile + servizi collegati)
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy – FantaCoppa</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/app-ui.css" rel="stylesheet">
    <style>
        .fc-privacy-page { max-width: 800px; margin: 0 auto; padding: 2rem 1rem 4rem; }
        .fc-privacy-page h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; }
        .fc-privacy-meta { color: #6c757d; font-size: 0.9rem; margin-bottom: 2rem; }
        .fc-privacy-page h2 { font-size: 1.2rem; font-weight: 600; margin-top: 2rem; margin-bottom: 0.75rem; }
        .fc-privacy-page p, .fc-privacy-page li { line-height: 1.65; color: #333; }
        .fc-privacy-page ul { padding-left: 1.25rem; }
        .fc-privacy-back { margin-bottom: 1.5rem; }
    </style>
</head>
<body class="bg-light">
    <div class="container fc-privacy-page">
        <p class="fc-privacy-back"><a href="index.php" class="text-decoration-none"><i class="bi bi-arrow-left"></i> Torna al sito</a></p>

        <h1>Privacy Policy – FantaCoppa</h1>
        <p class="fc-privacy-meta">Ultimo aggiornamento: <strong>11 febbraio 2026</strong></p>

        <p>
            La presente informativa descrive come <strong>FantaCoppa</strong> (di seguito &quot;noi&quot;, &quot;nostro&quot; o &quot;Titolare&quot;)
            tratta i dati personali degli utenti che utilizzano l’<strong>applicazione mobile FantaCoppa</strong> (di seguito &quot;App&quot;)
            e i servizi collegati resi tramite i nostri server. L’informativa è redatta in conformità al Regolamento (UE) 2016/679 (&quot;GDPR&quot;)
            e alla normativa italiana applicabile in materia di protezione dei dati personali.
        </p>

        <h2>1. Titolare del trattamento</h2>
        <p>
            Il Titolare del trattamento dei dati personali è il gestore di FantaCoppa, raggiungibile all’indirizzo email
            <a href="mailto:fantacoppa@gmail.com">fantacoppa@gmail.com</a> per qualsiasi richiesta relativa alla privacy o all’esercizio dei diritti elencati di seguito.
        </p>

        <h2>2. Ambito dell’informativa</h2>
        <p>
            Questa policy riguarda l’uso dell’App FantaCoppa (su dispositivi iOS e Android tramite gli store ufficiali o strumenti di sviluppo come Expo),
            l’accesso ai contenuti e alle funzionalità di gioco (fantacalcio: leghe, squadre, mercato, formazioni, voti, classifiche, calendario, ecc.)
            e le operazioni effettuate tramite i nostri sistemi backend collegati all’App. Eventuali servizi di terzi non integrati nell’App
            (es. pagine web esterne aperte dal browser) sono disciplinati dalle informative dei rispettivi fornitori.
        </p>

        <h2>3. Categorie di dati personali trattati</h2>
        <p>In funzione delle funzionalità che utilizzi, possiamo trattare le seguenti categorie di dati:</p>
        <ul>
            <li>
                <strong>Dati di registrazione e account:</strong> nome utente (username), indirizzo email e password.
                La password è conservata in forma crittografata (hash) sui nostri sistemi e non è visibile in chiaro al Titolare.
            </li>
            <li>
                <strong>Dati di autenticazione di sessione:</strong> l’App utilizza un token di accesso (JWT) per mantenere la sessione dopo il login.
                Il token e una copia sintetica dei dati profilo possono essere memorizzati in modo locale sul dispositivo
                (tramite le funzionalità di archiviazione sicura del sistema / AsyncStorage) per evitare di dover effettuare il login a ogni avvio.
            </li>
            <li>
                <strong>Dati di gioco e di lega:</strong> informazioni necessarie al funzionamento del fantacalcio, tra cui a titolo esemplificativo
                composizione delle squadre, rose, operazioni di mercato, formazioni, punteggi, classifiche, appartenenza a leghe,
                ruoli (es. amministratore di lega), impostazioni di lega che scegli o che applicano i regolamenti della piattaforma.
                Tali dati sono associati al tuo account e, ove previsto, sono visibili agli altri partecipanti alla stessa lega o contesto di gioco.
            </li>
            <li>
                <strong>Immagini caricate volontariamente:</strong> dove previsto dall’App (ad esempio logo di squadra/lega), puoi selezionare un’immagine
                dalla galleria del dispositivo; l’immagine viene inviata ai nostri server secondo i limiti tecnici indicati nell’interfaccia
                (formati e dimensioni massime). Il caricamento è facoltativo e serve esclusivamente a mostrare il contenuto nell’ambito dell’App.
            </li>
            <li>
                <strong>Dati tecnici e di utilizzo dell’App:</strong> per il corretto funzionamento del servizio e la sicurezza,
                i nostri server possono trattare dati quali indirizzo IP, data e ora delle richieste, tipo di client, nonché
                identificativi di versione dell’applicazione inviati tramite le intestazioni HTTP (ad esempio versione dell’App)
                per compatibilità, aggiornamenti obbligatori e prevenzione abusi.
            </li>
            <li>
                <strong>Dati relativi al recupero password:</strong> se utilizzi la funzione di password dimenticata, tratteremo l’indirizzo email
                che indichi per inviarti comunicazioni necessarie al reset (secondo le modalità implementate sul sistema).
            </li>
            <li>
                <strong>Preferenze locali sull’App:</strong> alcune impostazioni o stati dell’interfaccia possono essere salvati in locale sul dispositivo
                per migliorare l’esperienza (es. onboarding o preferenze non sensibili), senza che costituiscano un profilamento invasivo.
            </li>
        </ul>
        <p>
            Il conferimento dei dati contrattualmente necessari (account e dati di gioco collegati al servizio richiesto) è necessario per utilizzare le relative funzioni.
            Altri trattamenti (es. immagini facoltative) si basano sul tuo utilizzo volontario della funzione.
        </p>

        <h2>4. Finalità e basi giuridiche del trattamento</h2>
        <p>Trattiamo i dati per:</p>
        <ul>
            <li><strong>Erogazione del servizio e gestione dell’account</strong> (art. 6(1)(b) GDPR: esecuzione del contratto di cui sei parte).</li>
            <li><strong>Sicurezza, prevenzione frodi e abusi, rate limiting e stabilità del servizio</strong> (art. 6(1)(f) GDPR: legittimo interesse, bilanciato con i tuoi diritti).</li>
            <li><strong>Adempimenti di legge</strong> ove applicabili (art. 6(1)(c) GDPR).</li>
            <li><strong>Comunicazioni strettamente necessarie</strong> al servizio (es. recupero credenziali) in base alla funzione richiesta.</li>
        </ul>
        <p>
            Non utilizziamo i tuoi dati per decisioni unicamente automatizzate che producano effetti giuridici significativi su di te
            nel senso dell’art. 22 GDPR, salvo diversa comunicazione esplicita in futuro.
        </p>

        <h2>5. Modalità di accesso</h2>
        <p>
            L’accesso alle funzionalità principali dell’App avviene tramite <strong>registrazione</strong> con username, email e password,
            oppure tramite <strong>accesso</strong> con le credenziali già registrate. Le comunicazioni tra App e server avvengono tramite protocolli
            crittografati (HTTPS) ove configurato sul dominio di servizio.
        </p>

        <h2>6. Luogo del trattamento e responsabile del trattamento lato infrastruttura</h2>
        <p>
            I dati sono trattati su server e infrastrutture del Titolare / del provider di hosting scelto per il servizio
            (ad esempio ambienti di tipo web hosting con database e API applicative). Salvo diversa indicazione contrattuale,
            i trattamenti avvengono prevalentemente nell’Unione europea o in paesi per i quali siano previsti garanzie adeguate ai sensi degli artt. 44–49 GDPR.
        </p>

        <h2>7. Destinatari e servizi di terze parti</h2>
        <p>
            Per fornire l’App e distribuirla agli utenti possono essere coinvolti, nella loro qualità di autonomi titolari o responsabili,
            soggetti quali:
        </p>
        <ul>
            <li>
                <strong>Apple App Store e Google Play Store</strong> (o strumenti equivalenti): per la distribuzione dell’App, gli aggiornamenti e le informative
                sugli acquisti; si applicano le condizioni e le privacy policy della piattaforma che utilizzi.
            </li>
            <li>
                <strong>Fornitore del framework di sviluppo</strong> (es. Expo / React Native e relativi componenti): per la compilazione e l’esecuzione dell’App
                su dispositivo; tali soggetti possono trattare dati tecnici secondo le proprie informative.
            </li>
            <li>
                <strong>Provider di infrastruttura e connettività</strong> (hosting, DNS, email transazionale ove utilizzata per notifiche di sistema).
            </li>
        </ul>
        <p>
            <strong>Nota sulla versione attuale dell’App:</strong> al momento della redazione di questa informativa
            <strong>non risultano integrati nell’App strumenti di analisi del tipo Google Analytics</strong> né
            <strong>servizi di notifiche push</strong> (notifiche fuori dall’App tramite APNS/FCM) per finalità di marketing o analytics.
            Qualora tali strumenti fossero introdotti in futuro, l’informativa sarà aggiornata e, ove richiesto dalla legge,
            sarà richiesto un consenso specifico o saranno offerte opzioni di opt-out compatibili con la piattaforma.
        </p>

        <h2>8. Contenuti caricati dall’utente</h2>
        <p>
            Le immagini o altri file che carichi volontariamente (ove la funzione sia disponibile) sono trattati per essere mostrati
            nell’ambito dell’App e delle leghe a cui partecipi, secondo le regole di visibilità previste dalla piattaforma.
            Sei responsabile del contenuto che carichi: non deve violare diritti di terzi né norme applicabili.
        </p>

        <h2>9. Conservazione dei dati</h2>
        <p>
            I dati personali sono conservati per il tempo necessario a fornire il servizio, adempiere agli obblighi di legge,
            risolvere controversie e far valere i diritti. In assenza di esigenze diverse, i dati dell’account possono essere conservati
            finché l’account resta attivo; dopo la cancellazione possono permanere backup residui per un periodo tecnico limitato,
            salvo obblighi di conservazione più lunghi imposti dalla legge.
        </p>

        <h2>10. Sicurezza</h2>
        <p>
            Adottiamo misure tecniche e organizzative appropriate (inclusa la protezione delle credenziali con hash, uso di HTTPS ove configurato,
            limitazione degli accessi ai sistemi) per proteggere i dati da accessi non autorizzati, alterazione o divulgazione.
            Nessun sistema è privo di rischi: ti invitiamo a usare password robuste e a non condividere le credenziali.
        </p>

        <h2>11. Diritti dell’interessato</h2>
        <p>
            Ai sensi degli artt. 15–22 GDPR hai diritto di: <strong>accesso</strong>, <strong>rettifica</strong>, <strong>cancellazione</strong>,
            <strong>limitazione</strong> del trattamento, <strong>portabilità</strong> (ove applicabile), <strong>opposizione</strong> al trattamento basato sul legittimo interesse,
            nonché di revocare il consenso ove prestato, senza pregiudicare la liceità del trattamento precedente.
            Puoi proporre reclamo all’Autorità Garante per la protezione dei dati personali (<a href="https://www.garanteprivacy.it" target="_blank" rel="noopener noreferrer">www.garanteprivacy.it</a>).
        </p>
        <p>
            Per esercitare i diritti o per domande sulla privacy: <a href="mailto:fantacoppa@gmail.com">fantacoppa@gmail.com</a>.
        </p>

        <h2>12. Minori</h2>
        <p>
            L’App non è destinata al trattamento intenzionale di dati di minori di 14 anni senza il consenso del titolare della responsabilità genitoriale,
            ove richiesto dalla legge applicabile. Se ritieni che siano stati raccolti dati in violazione di questa policy, contattaci per la rimozione.
        </p>

        <h2>13. Modifiche alla presente informativa</h2>
        <p>
            Possiamo aggiornare questa Privacy Policy per adeguamenti normativi o modifiche all’App. La data di ultimo aggiornamento è indicata in cima al documento.
            Ti invitiamo a consultarla periodicamente; per modifiche sostanziali potremo fornire un avviso nell’App o sul sito ove opportuno.
        </p>

        <h2>14. Contatti</h2>
        <p>
            Per qualsiasi domanda o richiesta relativa al trattamento dei dati personali:<br>
            <strong>Email:</strong> <a href="mailto:fantacoppa@gmail.com">fantacoppa@gmail.com</a>
        </p>

        <p class="mt-4 text-muted small">
            Documento informativo. Per la versione legalmente vincolante in caso di discrepanze con testi negli store,
            far riferimento alla versione pubblicata sul sito ufficiale e alle condizioni applicabili al momento dell’uso del servizio.
        </p>
    </div>
</body>
</html>

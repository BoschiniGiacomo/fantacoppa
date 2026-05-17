const dns = require('dns').promises;
const net = require('net');
const nodemailer = require('nodemailer');

const LOG_SMTP = '[DEBUG_FORGOT_SMTP]';
const LOG_BREVO = '[DEBUG_FORGOT_BREVO]';

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/i;

function isValidEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

function maskEmail(value) {
  const s = String(value || '').trim();
  if (!s) return '(vuoto)';
  const at = s.indexOf('@');
  if (at <= 1) return `${s.slice(0, 1)}***`;
  return `${s.slice(0, 2)}***${s.slice(at)}`;
}

function maskUser(user) {
  const u = String(user || '').trim();
  if (!u) return '(vuoto)';
  if (u.length <= 12) return `${u.slice(0, 2)}***`;
  return `${u.slice(0, 3)}***${u.slice(-8)}`;
}

function logSmtpError(phase, error) {
  console.error(`${LOG_SMTP} ${phase} FALLITO:`, {
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    syscall: error?.syscall,
    address: error?.address,
    port: error?.port,
    response: error?.response,
    responseCode: error?.responseCode,
    command: error?.command,
  });
  explainSmtpFailure(error);
}

/** Suggerimenti in italiano in base al codice errore (senza stampare password). */
function explainSmtpFailure(error) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  const isIpv6 = /[a-f0-9:]+:\d+/i.test(msg) || msg.includes('::');

  if (code === 'ENETUNREACH' || (code === 'ESOCKET' && isIpv6)) {
    console.error(
      `${LOG_SMTP} DIAG: connessione IPv6 verso Gmail non raggiungibile da Render. ` +
        'Il transport forza IPv4; se persiste, controlla SMTP_HOST e riavvia dopo deploy.'
    );
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH') {
    console.error(
      `${LOG_SMTP} DIAG: Render piano FREE blocca le porte SMTP 25/465/587 dal 26/09/2025. ` +
        'Se il servizio è free, passa a un piano a pagamento su Render oppure usa invio via API HTTPS (non SMTP). ' +
        'Vedi https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports'
    );
  }
  if (code === 'EAUTH' || (error?.responseCode === 535)) {
    console.error(
      `${LOG_SMTP} DIAG: credenziali Gmail rifiutate. Usa una App Password (2FA attiva), non la password normale. ` +
        'SMTP_USERNAME = indirizzo Gmail completo, SMTP_PASSWORD = password app 16 caratteri.'
    );
  }
}

function getSmtpConfig(portOverride) {
  const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = portOverride ?? Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USERNAME || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || '').trim();
  return { host, port, user, pass };
}

function parseSenderFromEnv() {
  const fromName =
    String(process.env.BREVO_SENDER_NAME || process.env.SMTP_FROM_NAME || 'FantaCoppa').trim() ||
    'FantaCoppa';
  const fromAddress = String(
    process.env.BREVO_SENDER_EMAIL ||
      process.env.SMTP_FROM_ADDRESS ||
      process.env.SMTP_USERNAME ||
      ''
  ).trim();
  if (!isValidEmail(fromAddress)) {
    return null;
  }
  return {
    fromName,
    fromAddress,
    from: `"${fromName}" <${fromAddress}>`,
  };
}

function parseSmtpFrom() {
  return parseSenderFromEnv();
}

function getBrevoApiKey() {
  return String(process.env.BREVO_API_KEY || '').trim();
}

async function sendViaBrevo({ to, subject, html }) {
  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    console.log(`${LOG_BREVO} BREVO_API_KEY assente, skip`);
    return { ok: false, skipped: true };
  }

  const sender = parseSenderFromEnv();
  if (!sender) {
    console.error(
      `${LOG_BREVO} mittente non valido: imposta BREVO_SENDER_EMAIL=fantacoppadeicantoni@gmail.com (deve essere verificato su Brevo)`
    );
    return { ok: false, error: 'missing_sender' };
  }

  console.log(
    `${LOG_BREVO} invio via API HTTPS to=${maskEmail(to)} sender=${maskEmail(sender.fromAddress)}`
  );

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: sender.fromName, email: sender.fromAddress },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      console.error(`${LOG_BREVO} HTTP ${res.status}`, bodyText);
      explainBrevoFailure(res.status, bodyText);
      return { ok: false, error: bodyText };
    }

    let messageId = '';
    try {
      const parsed = JSON.parse(bodyText);
      messageId = parsed?.messageId || '';
    } catch {
      messageId = bodyText.slice(0, 80);
    }

    console.log(`${LOG_BREVO} inviata OK messageId=${messageId || '(n/a)'}`);
    return { ok: true, provider: 'brevo' };
  } catch (error) {
    console.error(`${LOG_BREVO} errore rete:`, error?.message || error);
    return { ok: false, error: error?.message || 'brevo_failed' };
  }
}

function explainBrevoFailure(status, bodyText) {
  const body = String(bodyText || '').toLowerCase();
  if (status === 401 || status === 403) {
    console.error(
      `${LOG_BREVO} DIAG: API key non valida o senza permessi. Crea una chiave v3 su Brevo → SMTP & API → API keys.`
    );
  }
  if (body.includes('sender') && (body.includes('not verified') || body.includes('invalid'))) {
    console.error(
      `${LOG_BREVO} DIAG: il mittente non è verificato su Brevo. Vai su Senders → aggiungi l'email → clicca il link di conferma nella inbox.`
    );
  }
}

/** Forza risoluzione DNS e socket su IPv4 (evita ENETUNREACH su IPv6 in cloud). */
function ipv4Lookup(hostname, options, callback) {
  const opts = { ...(options || {}), family: 4, all: false };
  require('dns').lookup(hostname, opts, callback);
}

function createMailerTransport(portOverride) {
  const { host, port, user, pass } = getSmtpConfig(portOverride);
  const maskedUser = maskUser(user);
  const passLen = pass ? pass.length : 0;

  console.log(
    `${LOG_SMTP} create transport host=${host} port=${port} user=${maskedUser} pass_len=${passLen} ipv4_forced=true`
  );

  if (!host || !user || !pass || !Number.isFinite(port) || port <= 0) {
    console.error(`${LOG_SMTP} config SMTP non valida o incompleta (host/user/pass/port)`);
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    family: 4,
    dns: { lookup: ipv4Lookup },
    tls: { rejectUnauthorized: false },
  });
}

function testTcpPort(host, port, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port, family: 4, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve({ ok: true, ms: Date.now() - started });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({
        ok: false,
        ms: Date.now() - started,
        code: err.code,
        message: err.message,
      });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        ok: false,
        ms: Date.now() - started,
        code: 'ETIMEDOUT',
        message: `timeout ${timeoutMs}ms`,
      });
    });
  });
}

async function logDnsDiagnostics(host) {
  try {
    const v4 = await dns.resolve4(host).catch((e) => ({ error: e.code || e.message }));
    const v6 = await dns.resolve6(host).catch((e) => ({ error: e.code || e.message }));
    console.log(`${LOG_SMTP} DNS ${host} A=`, Array.isArray(v4) ? v4.join(', ') : v4);
    console.log(`${LOG_SMTP} DNS ${host} AAAA=`, Array.isArray(v6) ? v6.join(', ') : v6);
  } catch (e) {
    console.error(`${LOG_SMTP} DNS lookup errore:`, e?.message || e);
  }
}

async function runBrevoDiagnostics(reason = 'startup') {
  const apiKey = getBrevoApiKey();
  const sender = parseSenderFromEnv();

  console.log(`${LOG_BREVO} === diagnostica Brevo (${reason}) ===`);
  console.log(`${LOG_BREVO} BREVO_API_KEY=${apiKey ? `presente (len=${apiKey.length})` : 'ASSENTE'}`);
  console.log(
    `${LOG_BREVO} mittente=${sender ? `${sender.fromName} <${maskEmail(sender.fromAddress)}>` : 'NON CONFIGURATO'}`
  );

  if (!apiKey) {
    console.warn(
      `${LOG_BREVO} Imposta BREVO_API_KEY su Render. Senza chiave si usa solo SMTP (bloccato su Render free).`
    );
    return;
  }

  if (!sender) {
    console.error(
      `${LOG_BREVO} Imposta BREVO_SENDER_EMAIL con l'indirizzo verificato su Brevo (es. fantacoppadeicantoni@gmail.com)`
    );
    return;
  }

  console.log(`${LOG_BREVO} provider=HTTPS api.brevo.com (ok su Render free)`);
  console.log(`${LOG_BREVO} === fine diagnostica Brevo ===`);
}

/**
 * Diagnostica rete/SMTP (solo se Brevo non configurato, o in locale).
 * Non logga mai password o segreti.
 */
async function runSmtpDiagnostics(reason = 'startup') {
  if (getBrevoApiKey()) {
    console.log(`${LOG_SMTP} Brevo configurato → skip diagnostica SMTP pesante (${reason})`);
    return;
  }

  const { host, port, user } = getSmtpConfig();
  const from = parseSmtpFrom();

  console.log(`${LOG_SMTP} === diagnostica SMTP (${reason}) ===`);
  console.log(`${LOG_SMTP} node=${process.version} platform=${process.platform} arch=${process.arch}`);
  console.log(
    `${LOG_SMTP} env: RENDER=${process.env.RENDER || '(no)'} ` +
      `RENDER_SERVICE_NAME=${process.env.RENDER_SERVICE_NAME || '(no)'} ` +
      `RENDER_INSTANCE_TYPE=${process.env.RENDER_INSTANCE_TYPE || '(no)'}`
  );
  console.log(`${LOG_SMTP} SMTP_HOST=${host} SMTP_PORT=${port} SMTP_USERNAME=${maskUser(user)}`);
  console.log(`${LOG_SMTP} mittente=${from ? from.from : '(non configurato)'}`);

  if (!user || !String(process.env.SMTP_PASSWORD || '').trim()) {
    console.error(`${LOG_SMTP} SMTP_PASSWORD o SMTP_USERNAME mancanti su Render → invio impossibile`);
    return;
  }

  await logDnsDiagnostics(host);

  for (const testPort of [port, 465, 587].filter((p, i, a) => a.indexOf(p) === i)) {
    const tcp = await testTcpPort(host, testPort);
    if (tcp.ok) {
      console.log(`${LOG_SMTP} TCP ${host}:${testPort} raggiungibile (${tcp.ms}ms, IPv4)`);
    } else {
      console.error(`${LOG_SMTP} TCP ${host}:${testPort} NON raggiungibile:`, tcp);
      if (tcp.code === 'ETIMEDOUT' || tcp.code === 'ECONNREFUSED') {
        console.error(
          `${LOG_SMTP} DIAG: porta ${testPort} bloccata o filtrata (tipico piano Render FREE). ` +
            'Upgrade a istanza a pagamento per ripristinare SMTP Gmail.'
        );
      }
    }
  }

  const transport = createMailerTransport();
  if (!transport) return;

  try {
    console.log(`${LOG_SMTP} verify transport principale (porta ${port})...`);
    await transport.verify();
    console.log(`${LOG_SMTP} verify transport principale OK`);
  } catch (error) {
    logSmtpError('verify transport principale', error);
  }

  console.log(`${LOG_SMTP} === fine diagnostica SMTP ===`);
}

let brevoDiagnosticsPromise = null;
let smtpDiagnosticsPromise = null;

function ensureEmailDiagnostics(reason) {
  if (!brevoDiagnosticsPromise) {
    brevoDiagnosticsPromise = runBrevoDiagnostics(reason).catch((e) => {
      console.error(`${LOG_BREVO} diagnostica crash:`, e?.message || e);
    });
  }
  if (!getBrevoApiKey() && !smtpDiagnosticsPromise) {
    smtpDiagnosticsPromise = runSmtpDiagnostics(reason).catch((e) => {
      console.error(`${LOG_SMTP} diagnostica crash:`, e?.message || e);
    });
  }
  return Promise.all([
    brevoDiagnosticsPromise,
    smtpDiagnosticsPromise || Promise.resolve(),
  ]);
}

async function sendViaSmtp({ to, subject, html }) {
  if (!getBrevoApiKey()) {
    await ensureEmailDiagnostics('before_send');
  }

  const fromParsed = parseSmtpFrom();
  if (!fromParsed) {
    console.error(
      `${LOG_SMTP} mittente non valido: imposta SMTP_FROM_ADDRESS o SMTP_USERNAME con email Gmail valida`
    );
    return { ok: false, error: 'missing_from' };
  }

  console.log(`${LOG_SMTP} avvio invio verso=${maskEmail(to)} from=${fromParsed.from}`);

  const transport = createMailerTransport();
  if (!transport) {
    return { ok: false, error: 'smtp_not_configured' };
  }

  const mail = {
    from: fromParsed.from,
    to,
    subject,
    html,
  };

  try {
    console.log(`${LOG_SMTP} verify transport principale...`);
    await transport.verify();
    console.log(`${LOG_SMTP} verify OK, invio mail principale...`);
    const info = await transport.sendMail(mail);
    console.log(`${LOG_SMTP} invio principale completato messageId=${info?.messageId || '(n/a)'}`);
    return { ok: true, provider: 'smtp' };
  } catch (firstError) {
    logSmtpError('invio principale', firstError);
  }

  try {
    console.log(`${LOG_SMTP} tentativo fallback SMTPS:465...`);
    const fallback = createMailerTransport(465);
    if (!fallback) return { ok: false, error: 'smtp_failed' };

    console.log(`${LOG_SMTP} verify fallback...`);
    await fallback.verify();
    console.log(`${LOG_SMTP} verify fallback OK, invio fallback...`);
    const info = await fallback.sendMail(mail);
    console.log(`${LOG_SMTP} invio fallback completato messageId=${info?.messageId || '(n/a)'}`);
    return { ok: true, provider: 'smtp465' };
  } catch (fallbackError) {
    logSmtpError('invio fallback', fallbackError);
    return { ok: false, error: fallbackError?.message || 'smtp_failed' };
  }
}

/**
 * Invio email: Brevo API (HTTPS, Render free) → fallback SMTP (locale / Render a pagamento).
 */
async function sendTransactionalEmail({ to, subject, html }) {
  await ensureEmailDiagnostics('before_send');

  console.log(`${LOG_BREVO} sendTransactionalEmail to=${maskEmail(to)} subject="${subject}"`);

  const brevo = await sendViaBrevo({ to, subject, html });
  if (brevo.ok) {
    console.log(`${LOG_BREVO} esito OK provider=${brevo.provider}`);
    return true;
  }

  if (!brevo.skipped) {
    console.warn(`${LOG_BREVO} Brevo fallito, provo SMTP...`);
  }

  const smtp = await sendViaSmtp({ to, subject, html });
  if (smtp.ok) {
    console.log(`${LOG_SMTP} esito OK provider=${smtp.provider}`);
    return true;
  }

  console.error(`${LOG_BREVO} esito FALLITO (Brevo e SMTP)`);
  return false;
}

function buildForgotPasswordHtml(newPassword) {
  return `
    <h2>Recupero Password - FantaCoppa</h2>
    <p>Ciao,</p>
    <p>Abbiamo ricevuto una richiesta di recupero password per il tuo account.</p>
    <p>La tua nuova password temporanea e: <strong>${newPassword}</strong></p>
    <p>Per sicurezza, ti consigliamo di cambiarla subito dopo l'accesso.</p>
    <br>
    <p>Saluti,<br>Team FantaCoppa</p>
  `;
}

async function runEmailDiagnostics(reason = 'startup') {
  await runBrevoDiagnostics(reason);
  await runSmtpDiagnostics(reason);
}

module.exports = {
  sendTransactionalEmail,
  buildForgotPasswordHtml,
  runEmailDiagnostics,
  runBrevoDiagnostics,
  runSmtpDiagnostics,
};

const dns = require('dns').promises;
const net = require('net');
const nodemailer = require('nodemailer');

const LOG = '[DEBUG_FORGOT_SMTP]';

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
  console.error(`${LOG} ${phase} FALLITO:`, {
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
      `${LOG} DIAG: connessione IPv6 verso Gmail non raggiungibile da Render. ` +
        'Il transport forza IPv4; se persiste, controlla SMTP_HOST e riavvia dopo deploy.'
    );
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH') {
    console.error(
      `${LOG} DIAG: Render piano FREE blocca le porte SMTP 25/465/587 dal 26/09/2025. ` +
        'Se il servizio è free, passa a un piano a pagamento su Render oppure usa invio via API HTTPS (non SMTP). ' +
        'Vedi https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports'
    );
  }
  if (code === 'EAUTH' || (error?.responseCode === 535)) {
    console.error(
      `${LOG} DIAG: credenziali Gmail rifiutate. Usa una App Password (2FA attiva), non la password normale. ` +
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

function parseSmtpFrom() {
  const fromName = String(process.env.SMTP_FROM_NAME || 'FantaCoppa').trim() || 'FantaCoppa';
  const fromAddress = String(
    process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USERNAME || ''
  ).trim();
  if (!isValidEmail(fromAddress)) {
    return null;
  }
  return { fromName, fromAddress, from: `"${fromName}" <${fromAddress}>` };
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
    `${LOG} create transport host=${host} port=${port} user=${maskedUser} pass_len=${passLen} ipv4_forced=true`
  );

  if (!host || !user || !pass || !Number.isFinite(port) || port <= 0) {
    console.error(`${LOG} config SMTP non valida o incompleta (host/user/pass/port)`);
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
    console.log(`${LOG} DNS ${host} A=`, Array.isArray(v4) ? v4.join(', ') : v4);
    console.log(`${LOG} DNS ${host} AAAA=`, Array.isArray(v6) ? v6.join(', ') : v6);
  } catch (e) {
    console.error(`${LOG} DNS lookup errore:`, e?.message || e);
  }
}

/**
 * Diagnostica rete/SMTP (chiamata all'avvio server e prima del primo invio).
 * Non logga mai password o segreti.
 */
async function runSmtpDiagnostics(reason = 'startup') {
  const { host, port, user } = getSmtpConfig();
  const from = parseSmtpFrom();

  console.log(`${LOG} === diagnostica SMTP (${reason}) ===`);
  console.log(`${LOG} node=${process.version} platform=${process.platform} arch=${process.arch}`);
  console.log(
    `${LOG} env: RENDER=${process.env.RENDER || '(no)'} ` +
      `RENDER_SERVICE_NAME=${process.env.RENDER_SERVICE_NAME || '(no)'} ` +
      `RENDER_INSTANCE_TYPE=${process.env.RENDER_INSTANCE_TYPE || '(no)'}`
  );
  console.log(`${LOG} SMTP_HOST=${host} SMTP_PORT=${port} SMTP_USERNAME=${maskUser(user)}`);
  console.log(`${LOG} mittente=${from ? from.from : '(non configurato)'}`);

  if (!user || !String(process.env.SMTP_PASSWORD || '').trim()) {
    console.error(`${LOG} SMTP_PASSWORD o SMTP_USERNAME mancanti su Render → invio impossibile`);
    return;
  }

  await logDnsDiagnostics(host);

  for (const testPort of [port, 465, 587].filter((p, i, a) => a.indexOf(p) === i)) {
    const tcp = await testTcpPort(host, testPort);
    if (tcp.ok) {
      console.log(`${LOG} TCP ${host}:${testPort} raggiungibile (${tcp.ms}ms, IPv4)`);
    } else {
      console.error(`${LOG} TCP ${host}:${testPort} NON raggiungibile:`, tcp);
      if (tcp.code === 'ETIMEDOUT' || tcp.code === 'ECONNREFUSED') {
        console.error(
          `${LOG} DIAG: porta ${testPort} bloccata o filtrata (tipico piano Render FREE). ` +
            'Upgrade a istanza a pagamento per ripristinare SMTP Gmail.'
        );
      }
    }
  }

  const transport = createMailerTransport();
  if (!transport) return;

  try {
    console.log(`${LOG} verify transport principale (porta ${port})...`);
    await transport.verify();
    console.log(`${LOG} verify transport principale OK`);
  } catch (error) {
    logSmtpError('verify transport principale', error);
  }

  console.log(`${LOG} === fine diagnostica SMTP ===`);
}

let diagnosticsPromise = null;

function ensureSmtpDiagnostics(reason) {
  if (!diagnosticsPromise) {
    diagnosticsPromise = runSmtpDiagnostics(reason).catch((e) => {
      console.error(`${LOG} diagnostica crash:`, e?.message || e);
    });
  }
  return diagnosticsPromise;
}

async function sendViaSmtp({ to, subject, html }) {
  await ensureSmtpDiagnostics('before_send');

  const fromParsed = parseSmtpFrom();
  if (!fromParsed) {
    console.error(
      `${LOG} mittente non valido: imposta SMTP_FROM_ADDRESS o SMTP_USERNAME con email Gmail valida`
    );
    return { ok: false, error: 'missing_from' };
  }

  console.log(`${LOG} avvio invio verso=${maskEmail(to)} from=${fromParsed.from}`);

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
    console.log(`${LOG} verify transport principale...`);
    await transport.verify();
    console.log(`${LOG} verify OK, invio mail principale...`);
    const info = await transport.sendMail(mail);
    console.log(`${LOG} invio principale completato messageId=${info?.messageId || '(n/a)'}`);
    return { ok: true, provider: 'smtp' };
  } catch (firstError) {
    logSmtpError('invio principale', firstError);
  }

  try {
    console.log(`${LOG} tentativo fallback SMTPS:465...`);
    const fallback = createMailerTransport(465);
    if (!fallback) return { ok: false, error: 'smtp_failed' };

    console.log(`${LOG} verify fallback...`);
    await fallback.verify();
    console.log(`${LOG} verify fallback OK, invio fallback...`);
    const info = await fallback.sendMail(mail);
    console.log(`${LOG} invio fallback completato messageId=${info?.messageId || '(n/a)'}`);
    return { ok: true, provider: 'smtp465' };
  } catch (fallbackError) {
    logSmtpError('invio fallback', fallbackError);
    return { ok: false, error: fallbackError?.message || 'smtp_failed' };
  }
}

/**
 * Invio email transazionale solo via SMTP (Gmail / provider configurato in env).
 */
async function sendTransactionalEmail({ to, subject, html }) {
  console.log(`${LOG} sendTransactionalEmail to=${maskEmail(to)} subject="${subject}"`);
  const smtp = await sendViaSmtp({ to, subject, html });
  if (smtp.ok) {
    console.log(`${LOG} esito OK provider=${smtp.provider}`);
    return true;
  }
  console.error(`${LOG} esito FALLITO`);
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

module.exports = {
  sendTransactionalEmail,
  buildForgotPasswordHtml,
  runSmtpDiagnostics,
  ensureSmtpDiagnostics,
};

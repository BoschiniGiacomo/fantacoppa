const nodemailer = require('nodemailer');

function buildFromHeader() {
  const fromName = String(process.env.SMTP_FROM_NAME || 'FantaCoppa').trim() || 'FantaCoppa';
  const fromAddress = String(
    process.env.RESEND_FROM || process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USERNAME || ''
  ).trim();
  if (!fromAddress) return null;
  return `"${fromName}" <${fromAddress}>`;
}

function createSmtpTransport(portOverride) {
  const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = portOverride ?? Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USERNAME || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || '').trim();
  if (!host || !user || !pass || !Number.isFinite(port) || port <= 0) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
    family: 4,
    tls: { rejectUnauthorized: false },
  });
}

async function sendViaResend({ to, subject, html }) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, skipped: true };

  const from = buildFromHeader();
  if (!from) {
    console.error('[EMAIL] RESEND: mittente non configurato (RESEND_FROM o SMTP_FROM_ADDRESS)');
    return { ok: false, error: 'missing_from' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[EMAIL] Resend HTTP', res.status, body);
      return { ok: false, error: body };
    }

    console.log('[EMAIL] inviata via Resend API');
    return { ok: true, provider: 'resend' };
  } catch (error) {
    console.error('[EMAIL] Resend errore:', error?.message || error);
    return { ok: false, error: error?.message || 'resend_failed' };
  }
}

async function sendViaSmtp({ to, subject, html }) {
  const from = buildFromHeader();
  if (!from) {
    console.error('[EMAIL] SMTP: mittente non configurato');
    return { ok: false, error: 'missing_from' };
  }

  const transport = createSmtpTransport();
  if (!transport) {
    console.error('[EMAIL] SMTP: config incompleta');
    return { ok: false, error: 'smtp_not_configured' };
  }

  const mail = { from, to, subject, html };

  try {
    await transport.sendMail(mail);
    console.log('[EMAIL] inviata via SMTP');
    return { ok: true, provider: 'smtp' };
  } catch (firstError) {
    console.error('[EMAIL] SMTP fallito:', {
      message: firstError?.message,
      code: firstError?.code,
    });
  }

  const fallback = createSmtpTransport(465);
  if (!fallback) return { ok: false, error: 'smtp_failed' };

  try {
    await fallback.sendMail(mail);
    console.log('[EMAIL] inviata via SMTP:465');
    return { ok: true, provider: 'smtp465' };
  } catch (fallbackError) {
    console.error('[EMAIL] SMTP:465 fallito:', {
      message: fallbackError?.message,
      code: fallbackError?.code,
    });
    return { ok: false, error: fallbackError?.message || 'smtp_failed' };
  }
}

/**
 * Invio email transazionale: su Render usa Resend (HTTPS); in locale può usare SMTP.
 */
async function sendTransactionalEmail({ to, subject, html }) {
  const resend = await sendViaResend({ to, subject, html });
  if (resend.ok) return true;
  if (!resend.skipped) {
    console.warn('[EMAIL] Resend non riuscito, provo SMTP...');
  }

  const smtp = await sendViaSmtp({ to, subject, html });
  return !!smtp.ok;
}

module.exports = {
  sendTransactionalEmail,
  buildForgotPasswordHtml,
};

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

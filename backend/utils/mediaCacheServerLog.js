/**
 * Log Render per lettura path media da DB (stesso stile di DEBUG_FORGOT_BREVO).
 * Nota: il download del file da Supabase avviene sul telefono, non su Render.
 */
const LOG = '[DEBUG_MEDIA_CACHE]';

function trimPath(value) {
  const s = value == null ? '' : String(value).trim();
  return s || null;
}

function clientMeta(req) {
  const forwarded = req?.get?.('x-forwarded-for');
  const ip =
    (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
    req?.ip ||
    '(unknown)';
  return {
    ip,
    appVersion: req?.get?.('X-App-Version') || '(no)',
    appVersionCode: req?.get?.('X-App-Version-Code') || '(no)',
  };
}

/**
 * @param {'app_loading'|'login_logo'} asset
 * @param {import('express').Request} req
 * @param {{ path?: string|null, type?: string|null, ok?: boolean, error?: string }} result
 */
function logMediaDbRead(asset, req, result = {}) {
  const labels = {
    app_loading: 'video/immagine caricamento',
    login_logo: 'logo login',
  };
  const label = labels[asset] || asset;
  const endpoint =
    asset === 'app_loading' ? 'GET /api/public/app-loading' : 'GET /api/public/login-logo';
  const meta = clientMeta(req);
  const pathVal = trimPath(result.path);
  const typeVal = trimPath(result.type);
  const ok = result.ok !== false && !result.error;

  console.log(`${LOG} === lettura ${label} da DB ===`);
  console.log(`${LOG} endpoint=${endpoint}`);
  console.log(`${LOG} esito=${ok ? 'ok' : 'errore'}${result.error ? ` error=${result.error}` : ''}`);

  if (!pathVal) {
    console.log(`${LOG} path=(nessuno configurato in app_settings)`);
  } else {
    console.log(`${LOG} path=${pathVal}${typeVal ? ` type=${typeVal}` : ''}`);
  }

  console.log(
    `${LOG} client: ip=${meta.ip} appVersion=${meta.appVersion} build=${meta.appVersionCode}`
  );
  console.log(
    `${LOG} nota: questa riga = solo query DB (path). Il file Supabase si scarica sul telefono se non è in cache disco.`
  );
  console.log(`${LOG} === fine lettura ${label} da DB ===`);
}

/**
 * Eventi inviati dall'app (cache locale vs download rete) — visibili su Render.
 * @param {import('express').Request} req
 * @param {{ asset?: string, event?: string, path?: string, uriSource?: string, layer?: string }} body
 */
function logMediaClientEvent(req, body = {}) {
  const asset = trimPath(body.asset) || '(unknown)';
  const event = trimPath(body.event) || '(unknown)';
  const pathVal = trimPath(body.path);
  const uriSource = trimPath(body.uriSource) || '(no)';
  const layer = trimPath(body.layer) || '(no)';
  const meta = clientMeta(req);

  console.log(`${LOG} === evento app (${asset}) ===`);
  console.log(`${LOG} event=${event} uriSource=${uriSource} layer=${layer}`);
  if (pathVal) console.log(`${LOG} path=${pathVal}`);
  console.log(
    `${LOG} client: ip=${meta.ip} appVersion=${meta.appVersion} build=${meta.appVersionCode}`
  );
  const assetLabel =
    asset === 'team_logo'
      ? 'logo squadra ufficiale'
      : asset === 'fantasy_team_logo'
        ? 'logo squadra fantasy'
        : asset === 'player_photo'
          ? 'foto giocatore'
          : asset === 'loading_video'
            ? 'video caricamento'
            : asset === 'login_logo'
              ? 'logo login'
              : asset;

  if (uriSource === 'local_disk') {
    console.log(
      `${LOG} interpretazione: ${assetLabel} da disco telefono (nessun egress Supabase per questo file)`
    );
  } else if (uriSource === 'remote_network') {
    console.log(
      `${LOG} interpretazione: ${assetLabel} da URL remoto (possibile egress Supabase)`
    );
  } else if (event === 'disk_download_start') {
    console.log(`${LOG} interpretazione: download ${assetLabel} da Supabase in corso sul telefono`);
  } else if (event === 'disk_hit' || event === 'disk_download_ok') {
    console.log(`${LOG} interpretazione: cache disco ok per ${assetLabel}`);
  } else if (String(event).includes('display_resolve')) {
    console.log(`${LOG} interpretazione: risoluzione ${assetLabel} per visualizzazione in app`);
  }
  console.log(`${LOG} === fine evento app (${asset}) ===`);
}

module.exports = {
  LOG,
  logMediaDbRead,
  logMediaClientEvent,
};

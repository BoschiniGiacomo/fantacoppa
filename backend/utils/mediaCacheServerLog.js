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
 * @param {'app_loading'|'login_logo'|'login_background'} asset
 * @param {import('express').Request} req
 * @param {{ path?: string|null, type?: string|null, ok?: boolean, error?: string }} result
 */
function logMediaDbRead(asset, req, result = {}) {
  const labels = {
    app_loading: 'video/immagine caricamento',
    login_logo: 'logo login',
    login_background: 'sfondo login',
  };
  const label = labels[asset] || asset;
  const endpoint =
    asset === 'app_loading'
      ? 'GET /api/public/app-loading'
      : asset === 'login_background'
        ? 'GET /api/public/login-background'
        : 'GET /api/public/login-logo';
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

/** Su Render logghiamo solo eventi con egress Supabase (vecchie app possono ancora inviare disk_hit). */
function shouldLogClientEventOnRender(body = {}) {
  const event = String(body.event || '').trim();
  const uriSource = String(body.uriSource || '').trim();

  if (uriSource === 'local_disk') return false;
  if (event === 'disk_hit' || event.endsWith('_display_resolve')) return false;
  if (
    event.includes('cache_disk') ||
    event === 'logo_resolved' ||
    event === 'login_bg_resolved' ||
    event === 'loading_api'
  ) {
    return false;
  }

  return (
    event === 'disk_download_start' ||
    event === 'disk_download_ok' ||
    event === 'disk_download_fail_remote_fallback' ||
    event === 'loading_cache_v3_video_remote' ||
    event === 'logo_cache_async_remote' ||
    event.endsWith('_remote_only')
  );
}

/**
 * Eventi inviati dall'app — su Render solo download / fallback remoto.
 * @param {import('express').Request} req
 * @param {{ asset?: string, event?: string, path?: string, uriSource?: string, layer?: string }} body
 */
function logMediaClientEvent(req, body = {}) {
  if (!shouldLogClientEventOnRender(body)) return;

  const asset = trimPath(body.asset) || '(unknown)';
  const event = trimPath(body.event) || '(unknown)';
  const pathVal = trimPath(body.path);
  const meta = clientMeta(req);

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
              : asset === 'login_background'
                ? 'sfondo login'
                : asset;

  console.log(`${LOG} === download Supabase (${asset}) ===`);
  console.log(`${LOG} event=${event}`);
  if (pathVal) console.log(`${LOG} path=${pathVal}`);
  console.log(
    `${LOG} client: ip=${meta.ip} appVersion=${meta.appVersion} build=${meta.appVersionCode}`
  );

  if (event === 'disk_download_start') {
    console.log(`${LOG} interpretazione: egress — download ${assetLabel} avviato sul telefono`);
  } else if (event === 'disk_download_ok') {
    console.log(`${LOG} interpretazione: egress — download ${assetLabel} completato e salvato in locale`);
  } else if (event === 'disk_download_fail_remote_fallback') {
    console.log(`${LOG} interpretazione: download fallito, uso URL remoto (egress possibile)`);
  } else {
    console.log(`${LOG} interpretazione: egress — ${assetLabel} servito da rete (non da cache disco)`);
  }
  console.log(`${LOG} === fine download Supabase (${asset}) ===`);
}

module.exports = {
  LOG,
  logMediaDbRead,
  logMediaClientEvent,
};

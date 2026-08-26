/**
 * Log Render per path media da DB / download client.
 * Una riga per lettura DB; una-due per egress reale.
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

function shortClient(meta) {
  return `v${meta.appVersion}#${meta.appVersionCode} ip=${meta.ip}`;
}

/**
 * @param {'app_loading'|'login_logo'|'login_background'|'match_background'} asset
 * @param {import('express').Request} req
 * @param {{ path?: string|null, type?: string|null, ok?: boolean, error?: string }} result
 */
function logMediaDbRead(asset, req, result = {}) {
  const meta = clientMeta(req);
  const pathVal = trimPath(result.path) || '(none)';
  const typeVal = trimPath(result.type);
  const ok = result.ok !== false && !result.error;
  const status = ok ? 'ok' : `err${result.error ? `=${result.error}` : ''}`;
  const typePart = typeVal ? ` type=${typeVal}` : '';
  // Solo path da DB: se path = bundle app non c'è download.
  console.log(`${LOG} db ${asset} ${status} path=${pathVal}${typePart} ${shortClient(meta)}`);
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
  const pathPart = pathVal ? ` path=${pathVal}` : '';
  console.log(`${LOG} egress ${asset} ${event}${pathPart} ${shortClient(meta)}`);
}

module.exports = {
  LOG,
  logMediaDbRead,
  logMediaClientEvent,
};

import api from '../services/api';

const TAG = '[FC-MediaCache]';

/** Eventi inviati a Render (evita spam su ogni ui_context). */
const RENDER_REPORT_EVENTS = new Set([
  'disk_download_start',
  'disk_download_ok',
  'disk_download_fail_remote_fallback',
  'disk_hit',
  'loading_cache_v3_video_disk',
  'loading_cache_v3_video_remote',
  'loading_cache_v2',
  'logo_cache_disk',
  'logo_cache_async_remote',
  'logo_resolved',
  'loading_api',
  'loading_api_error',
]);

const recentRenderReports = new Map();
const RENDER_DEDUPE_MS = 15000;

/** local_disk | remote_network | none */
export function mediaUriSource(uri) {
  if (!uri) return 'none';
  const s = String(uri);
  if (s.startsWith('file://') || s.startsWith('content://')) return 'local_disk';
  if (/^https?:\/\//i.test(s)) return 'remote_network';
  return 'unknown';
}

function inferAsset(event, payload) {
  if (payload.asset) return payload.asset;
  if (event.includes('logo')) return 'login_logo';
  if (event.includes('loading') || event.includes('disk_')) return 'loading_video';
  return 'media';
}

function shouldReportToRender(event, payload) {
  if (!RENDER_REPORT_EVENTS.has(event)) return false;
  if (payload.layer === 'ui_context') return false;
  const key = `${event}|${payload.path || ''}|${payload.uriSource || ''}`;
  const now = Date.now();
  const last = recentRenderReports.get(key);
  if (last && now - last < RENDER_DEDUPE_MS) return false;
  recentRenderReports.set(key, now);
  return true;
}

function reportToRender(event, payload) {
  if (!shouldReportToRender(event, payload)) return;
  const body = {
    event,
    asset: inferAsset(event, payload),
    path: payload.path || null,
    uriSource: payload.uriSource || null,
    layer: payload.layer || null,
    type: payload.type || null,
    savedToDisk: payload.savedToDisk,
    hasLocalFile: payload.hasLocalFile,
  };
  api.post('/public/media-cache-event', body).catch(() => {});
}

export function logMediaCache(event, payload = {}) {
  const uri = payload.uri;
  const extra = { ...payload };
  if (uri != null) {
    extra.uriSource = mediaUriSource(uri);
    extra.uriPrefix = String(uri).slice(0, 48);
    delete extra.uri;
  }
  console.log(TAG, event, extra);
  reportToRender(event, extra);
}

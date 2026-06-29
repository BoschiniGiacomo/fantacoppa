import api from '../services/api';

/**
 * Eventi inviati a Render (POST /public/media-cache-event) per egress Supabase.
 * Nessun log in Metro: solo download/fallback remoto, non hit locale.
 */
const RENDER_REPORT_EVENTS = new Set([
  'disk_download_start',
  'disk_download_ok',
  'disk_download_fail_remote_fallback',
  'loading_cache_v3_video_remote',
  'logo_cache_async_remote',
  'team_logo_remote_only',
  'fantasy_team_logo_remote_only',
  'login_bg_remote_only',
  'player_photo_remote_only',
  'login_bg_cache_async_remote',
  'loading_api_error',
]);

const recentRenderReports = new Map();
const RENDER_DEDUPE_MS = 15000;

/** local_disk | bundled | remote_network | none */
export function mediaUriSource(uri) {
  if (!uri) return 'none';
  const s = String(uri);
  if (s.startsWith('file://') || s.startsWith('content://')) return 'local_disk';
  if (s.startsWith('asset://')) return 'bundled';
  if (/^https?:\/\//i.test(s)) {
    if (s.includes('/assets/') && (s.includes('uploads%2F') || s.includes('/uploads/'))) return 'bundled';
    return 'remote_network';
  }
  return 'bundled';
}

function inferAsset(event, payload) {
  if (payload.asset) return payload.asset;
  if (event.includes('player_photo')) return 'player_photo';
  if (event.includes('fantasy_team')) return 'fantasy_team_logo';
  if (event.includes('team_logo')) return 'team_logo';
  if (event.includes('login_bg') || payload.asset === 'login_background') return 'login_background';
  if (event.includes('login') || event.includes('logo_')) return 'login_logo';
  if (event.includes('loading') || event.includes('disk_')) return 'loading_video';
  return 'media';
}

function shouldReportToRender(event, payload) {
  if (!RENDER_REPORT_EVENTS.has(event)) return false;
  if (payload.uriSource === 'local_disk') return false;
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
    delete extra.uri;
  }
  reportToRender(event, extra);
}

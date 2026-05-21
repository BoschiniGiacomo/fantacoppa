const TAG = '[FC-MediaCache]';

/** local_disk | remote_network | async_storage_remote | api_path | none */
export function mediaUriSource(uri) {
  if (!uri) return 'none';
  const s = String(uri);
  if (s.startsWith('file://') || s.startsWith('content://')) return 'local_disk';
  if (/^https?:\/\//i.test(s)) return 'remote_network';
  return 'unknown';
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
}

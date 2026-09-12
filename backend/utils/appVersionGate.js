/**
 * Gate versione app: hard 426 vs soft update per client "crashy".
 *
 * Client con versionCode < FORCE_UPDATE_UI_MIN_SAFE_VERSION_CODE crashano sul 426
 * (bug hooks UpdateRequiredScreen). Per quelli: niente 426, ma payload soft
 * su endpoint pubblici esenti (es. /public/app-loading).
 */

const MIN_SUPPORTED_APP_VERSION_CODE = parseInt(process.env.MIN_SUPPORTED_APP_VERSION_CODE || '0', 10) || 0;
const APP_FORCE_UPDATE_URL = (process.env.APP_FORCE_UPDATE_URL || '').trim();

const FORCE_UPDATE_UI_MIN_SAFE_VERSION_CODE = (() => {
  const raw = process.env.FORCE_UPDATE_UI_MIN_SAFE_VERSION_CODE;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 17;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : 17;
})();

function readClientVersionCode(req) {
  return parseInt(req?.get?.('X-App-Version-Code') || '0', 10) || 0;
}

function isBelowMinSupported(versionCode) {
  if (MIN_SUPPORTED_APP_VERSION_CODE <= 0) return false;
  return versionCode < MIN_SUPPORTED_APP_VERSION_CODE;
}

/** Client che crashano se ricevono HTTP 426. */
function isCrashyForceUpdateClient(versionCode) {
  return (
    FORCE_UPDATE_UI_MIN_SAFE_VERSION_CODE > 0
    && versionCode > 0
    && versionCode < FORCE_UPDATE_UI_MIN_SAFE_VERSION_CODE
  );
}

function buildForceUpdatePayload(versionCode) {
  return {
    code: 'UPDATE_REQUIRED',
    message: 'Questa versione dell\'app non e piu supportata. Aggiorna per continuare.',
    current_version_code: versionCode,
    min_supported_version_code: MIN_SUPPORTED_APP_VERSION_CODE,
    update_url: APP_FORCE_UPDATE_URL || null,
  };
}

/**
 * Soft signal da allegare a risposte 200 su endpoint esenti.
 * Vale per tutti i client sotto la min (anche crashy).
 */
function getSoftForceUpdateFields(req) {
  const versionCode = readClientVersionCode(req);
  if (!isBelowMinSupported(versionCode)) return null;
  if (versionCode <= 0) return null;
  return {
    update_required: true,
    ...buildForceUpdatePayload(versionCode),
  };
}

module.exports = {
  MIN_SUPPORTED_APP_VERSION_CODE,
  APP_FORCE_UPDATE_URL,
  FORCE_UPDATE_UI_MIN_SAFE_VERSION_CODE,
  readClientVersionCode,
  isBelowMinSupported,
  isCrashyForceUpdateClient,
  buildForceUpdatePayload,
  getSoftForceUpdateFields,
};

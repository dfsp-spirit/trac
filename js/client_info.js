// @ts-check
/**
 * Browser/device identification capture.
 *
 * Records the raw user agent plus a parsed snapshot (ua-parser-js) and a few
 * environment signals, so researchers can tell whether the app works for
 * participants on different devices. The data is stored per participant and
 * exported with the research data.
 *
 * Design notes:
 * - The backend also sees the `User-Agent` header, but Client Hints, screen size,
 *   touch support and DPR are only visible in the browser, and modern Chromium
 *   reduces the UA string. Capturing client-side and storing both is the most
 *   robust option.
 * - The raw user agent is sent verbatim so records can be re-parsed later when
 *   the parsing rules improve.
 * - Everything here is best-effort: a failure must never break the diary, so all
 *   errors are swallowed (and logged) rather than propagated.
 *
 * Controlled by the per-study `save_browser_identification` flag, which is
 * **opt-in and off by default** (the backend enforces the flag as well and
 * stores nothing when it is disabled). For studies that require consent,
 * capture is skipped until consent is given.
 *
 * @module client_info
 */

/** Name of the parsing library, stored with each record for traceability. */
export const PARSER_LIBRARY = 'ua-parser-js';

/**
 * Vendored parser version. Keep in sync with
 * `src/assets/ua-parser-js/ua-parser.min.js` (see that folder's README).
 */
export const PARSER_VERSION = '1.0.41';

/** localStorage key prefix used to avoid re-posting on every page load. */
const STORAGE_KEY_PREFIX = 'trac_client_info_sent:';

/**
 * @returns {string|null} The base API URL, or null when settings are missing.
 */
function getApiBaseUrl() {
  const settings = window.TUD_SETTINGS;
  if (settings && typeof settings.API_BASE_URL === 'string') {
    return settings.API_BASE_URL;
  }
  console.warn(
    'client_info: TUD_SETTINGS.API_BASE_URL unavailable; skipping capture.'
  );
  return null;
}

/**
 * @param {string} studyNameShort
 * @param {string} participantId
 * @returns {string}
 */
function storageKey(studyNameShort, participantId) {
  return `${STORAGE_KEY_PREFIX}${studyNameShort}:${participantId}`;
}

/**
 * @param {string} studyNameShort
 * @param {string} participantId
 * @returns {boolean}
 */
function hasAlreadySent(studyNameShort, participantId) {
  try {
    return window.localStorage.getItem(storageKey(studyNameShort, participantId)) === '1';
  } catch (error) {
    // Private mode / storage disabled: fall back to always attempting the POST.
    return false;
  }
}

/**
 * @param {string} studyNameShort
 * @param {string} participantId
 */
function markAsSent(studyNameShort, participantId) {
  try {
    window.localStorage.setItem(storageKey(studyNameShort, participantId), '1');
  } catch (error) {
    // Non-fatal: worst case the POST runs again on the next page load and the
    // backend simply records another capture.
  }
}

/**
 * Read high-entropy Client Hints when the browser supports them (Chromium).
 * Resolves to null everywhere else. Never rejects.
 *
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function readClientHints() {
  try {
    // Client Hints are not part of every TypeScript DOM lib version, so read
    // them through an untyped view of navigator.
    const navigatorWithHints = /** @type {any} */ (navigator);
    const uaData = navigatorWithHints.userAgentData;
    if (!uaData) {
      return null;
    }
    /** @type {Record<string, unknown>} */
    const hints = {
      mobile: uaData.mobile,
      platform: uaData.platform,
      brands: uaData.brands,
    };
    if (typeof uaData.getHighEntropyValues === 'function') {
      const highEntropy = await uaData.getHighEntropyValues([
        'architecture',
        'bitness',
        'model',
        'platformVersion',
        'uaFullVersion',
        'fullVersionList',
      ]);
      hints.high_entropy = highEntropy;
    }
    return hints;
  } catch (error) {
    console.warn('client_info: reading Client Hints failed', error);
    return null;
  }
}

/**
 * Build the client-info snapshot.
 * @param {Record<string, unknown>|null} [clientHints]
 * @returns {Record<string, unknown>}
 */
function buildClientInfo(clientHints = null) {
  /** @type {Record<string, unknown>} */
  const clientInfo = {
    parser_library: PARSER_LIBRARY,
    parser_version: PARSER_VERSION,
  };

  // Parsed snapshot. Absent when the vendored bundle did not load (e.g. blocked
  // by a CSP) -- the raw user agent below is still recorded in that case.
  const UAParser = window.UAParser;
  if (typeof UAParser === 'function') {
    try {
      const parsed = new UAParser(navigator.userAgent).getResult();
      clientInfo.browser = parsed.browser;
      clientInfo.engine = parsed.engine;
      clientInfo.os = parsed.os;
      clientInfo.device = parsed.device;
      clientInfo.cpu = parsed.cpu;
    } catch (error) {
      console.warn('client_info: ua-parser-js parsing failed', error);
    }
  } else {
    console.warn(
      'client_info: window.UAParser is unavailable; recording the raw user agent only.'
    );
    clientInfo.parser_library = null;
    clientInfo.parser_version = null;
  }

  // Environment signals that the server cannot see. Guarded individually
  // because not all of them exist in every browser.
  clientInfo.screen = {
    width: window.screen ? window.screen.width : null,
    height: window.screen ? window.screen.height : null,
    color_depth: window.screen ? window.screen.colorDepth : null,
  };
  clientInfo.viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  clientInfo.device_pixel_ratio = window.devicePixelRatio;
  clientInfo.max_touch_points =
    typeof navigator.maxTouchPoints === 'number'
      ? navigator.maxTouchPoints
      : null;
  clientInfo.platform = navigator.platform || null;
  clientInfo.language = navigator.language || null;
  clientInfo.languages =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? [...navigator.languages]
      : null;
  try {
    clientInfo.timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch (error) {
    clientInfo.timezone = null;
  }
  if (typeof navigator.hardwareConcurrency === 'number') {
    clientInfo.hardware_concurrency = navigator.hardwareConcurrency;
  }

  clientInfo.client_hints = clientHints;

  return clientInfo;
}

/**
 * Send the snapshot with `navigator.sendBeacon` when available.
 *
 * The capture runs right after the study config loads, which for studies that
 * require consent is immediately followed by a navigation to the consent page.
 * A plain `fetch` is aborted by that navigation (`net::ERR_ABORTED`), losing the
 * data. A beacon is queued by the browser and survives the unload, which is
 * exactly what is needed here.
 *
 * @param {string} url
 * @param {Record<string, unknown>} payload
 * @returns {boolean} true when the browser accepted the beacon for delivery.
 */
function sendViaBeacon(url, payload) {
  if (typeof navigator.sendBeacon !== 'function') {
    return false;
  }
  try {
    const body = new Blob([JSON.stringify(payload)], {
      type: 'application/json',
    });
    return navigator.sendBeacon(url, body);
  } catch (error) {
    console.warn('client_info: beacon failed, falling back to fetch', error);
    return false;
  }
}

/**
 * Capture and submit browser/device identification once per participant.
 *
 * Safe to call on every page load: it no-ops when the study disables the
 * feature, when there is no participant id to attribute the data to, or when
 * this participant already sent data from this browser. It never throws.
 *
 * @param {Object} options
 * @param {string|null|undefined} options.studyNameShort
 * @param {string|null|undefined} options.participantId
 * @param {boolean|undefined} options.enabled Study's `save_browser_identification` flag.
 * @param {boolean} [options.requiresConsent] Study requires consent (`require_consent`).
 * @param {boolean} [options.consentGiven] Whether consent has been given already.
 * @returns {Promise<{sent: boolean, reason?: string, transport?: string}>}
 */
export async function captureClientInfoIfEnabled({
  studyNameShort,
  participantId,
  enabled,
  requiresConsent = false,
  consentGiven = false,
}) {
  if (!enabled) {
    return { sent: false, reason: 'disabled_for_study' };
  }
  // The capture runs before the participant has necessarily reached (or passed)
  // the consent page. Device data must not be collected from someone who has not
  // consented, so consent-requiring studies only capture once consent is given.
  if (requiresConsent && !consentGiven) {
    return { sent: false, reason: 'consent_not_given' };
  }
  if (!studyNameShort || !participantId) {
    return { sent: false, reason: 'missing_study_or_participant' };
  }
  if (hasAlreadySent(studyNameShort, participantId)) {
    return { sent: false, reason: 'already_sent' };
  }

  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return { sent: false, reason: 'no_api_base_url' };
  }

  try {
    const clientHints = await readClientHints();
    const payload = {
      user_agent: navigator.userAgent,
      client_info: buildClientInfo(clientHints),
    };

    const url =
      `${apiBaseUrl}/studies/${encodeURIComponent(studyNameShort)}` +
      `/participants/${encodeURIComponent(participantId)}/client-info`;

    // Preferred path: survives the redirect that usually follows config load.
    // A beacon cannot report an HTTP status, so acceptance is treated as sent;
    // the endpoint is idempotent, so a duplicate would only bump capture_count.
    if (sendViaBeacon(url, payload)) {
      markAsSent(studyNameShort, participantId);
      console.log('client_info: browser identification queued (beacon)');
      return { sent: true, transport: 'beacon' };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });

    if (!response.ok) {
      // Leave the localStorage marker unset so a later page load retries.
      console.warn(
        `client_info: submission failed with HTTP ${response.status}; will retry on next load.`
      );
      return { sent: false, reason: `http_${response.status}` };
    }

    markAsSent(studyNameShort, participantId);
    console.log('client_info: browser identification stored');
    return { sent: true };
  } catch (error) {
    console.warn('client_info: submission failed', error);
    return { sent: false, reason: 'request_failed' };
  }
}

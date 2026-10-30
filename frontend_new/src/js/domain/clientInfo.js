// @ts-check
/**
 * Browser/device identification: what to send and when.
 *
 * The study opts in with `save_browser_identification`. What we send is just
 * what only the browser knows (screen, viewport, touch support, time zone, ...)
 * plus the user agent verbatim - no parsing. Parsing rules improve, so a stored
 * parser result goes stale while the raw values stay re-derivable; the backend
 * drops anything outside its whitelist anyway.
 *
 * Two rules from the backlog shape this module:
 *  - device data must not be collected from someone who has not consented
 *    (D38), so a consent-requiring study captures only after consent;
 *  - the rewrite has no device storage (D33), so "already sent" cannot be
 *    remembered locally. The caller may post on every load; the server treats an
 *    unchanged snapshot as the same capture instead of counting another one.
 */

/**
 * @typedef {Object} ClientEnvironment
 * @property {string} [userAgent]
 * @property {string} [platform]
 * @property {string} [language]
 * @property {string} [timeZone]
 * @property {{ width?: number, height?: number }} [screen]
 * @property {{ width?: number, height?: number }} [viewport]
 * @property {number} [devicePixelRatio]
 * @property {number} [maxTouchPoints]
 */

/**
 * Whether this page load should report the device.
 *
 * @param {any} session The study-config payload.
 * @returns {boolean}
 */
export function shouldCaptureClientInfo(session) {
  if (!session || session.save_browser_identification !== true) return false;
  // Nothing to capture on a page that is not part of the study flow.
  if (!session.stage) return false;
  if (session.require_consent === true && session.consent_given !== true) return false;
  return true;
}

/**
 * The request body for `POST .../client-info`.
 *
 * Missing values are omitted rather than sent as null, so the stored blob only
 * contains what the browser actually answered.
 *
 * @param {ClientEnvironment} environment
 * @returns {{ user_agent?: string, client_info: Record<string, unknown> }}
 */
export function buildClientInfo(environment) {
  /** @type {Record<string, unknown>} */
  const clientInfo = {};

  /** @param {string} key @param {unknown} value */
  const put = (key, value) => {
    if (value !== undefined && value !== null && value !== '') clientInfo[key] = value;
  };

  put('platform', environment.platform);
  put('language', environment.language);
  put('timezone', environment.timeZone);

  const screen = environment.screen;
  if (screen && (screen.width !== undefined || screen.height !== undefined)) {
    /** @type {Record<string, number>} */
    const size = {};
    if (typeof screen.width === 'number') size.width = screen.width;
    if (typeof screen.height === 'number') size.height = screen.height;
    clientInfo.screen = size;
  }

  const viewport = environment.viewport;
  if (viewport && typeof viewport.width === 'number' && typeof viewport.height === 'number') {
    clientInfo.viewport = { width: viewport.width, height: viewport.height };
  }

  put('device_pixel_ratio', environment.devicePixelRatio);
  put('max_touch_points', environment.maxTouchPoints);

  /** @type {{ user_agent?: string, client_info: Record<string, unknown> }} */
  const body = { client_info: clientInfo };
  if (environment.userAgent) body.user_agent = environment.userAgent;
  return body;
}

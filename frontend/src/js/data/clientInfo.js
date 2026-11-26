// @ts-check
/**
 * Reporting the device to the backend, once per page load, when the study asks
 * for it.
 *
 * Everything here is best-effort: identification is never worth breaking a diary
 * for, so a failed request is logged and dropped. The decision what to send lives
 * in `domain/clientInfo.js` (pure); this module reads the DOM and does the POST.
 */
import { buildClientInfo, shouldCaptureClientInfo } from '../domain/clientInfo.js';

/**
 * @returns {import('../domain/clientInfo.js').ClientEnvironment}
 */
export function readClientEnvironment() {
  /** @returns {string | undefined} */
  const timeZone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
      return undefined;
    }
  };

  return {
    userAgent: navigator.userAgent || undefined,
    platform: navigator.platform || undefined,
    language: navigator.language || undefined,
    timeZone: timeZone(),
    screen: { width: window.screen?.width, height: window.screen?.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    maxTouchPoints:
      typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : undefined,
  };
}

/**
 * Report the device for this study, if it collects that data.
 *
 * Best-effort by design: identification is never worth breaking a diary for, so
 * a failure is logged and dropped.
 *
 * @param {{ submitClientInfo: (body: any) => Promise<any> } | null} api
 * @param {any} session The study-config payload.
 */
export function reportClientInfo(api, session) {
  if (!api || !shouldCaptureClientInfo(session)) return;
  try {
    void api
      .submitClientInfo(buildClientInfo(readClientEnvironment()))
      .catch((error) => console.warn('[client-info] could not report the device:', error));
  } catch (error) {
    console.warn('[client-info] could not read the environment:', error);
  }
}

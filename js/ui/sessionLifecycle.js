// @ts-check
/**
 * Invisible inactivity lifecycle for studies that opt into a session timeout.
 *
 * There is deliberately no countdown UI: the timer only decides when to leave
 * for the timeout page, and user activity refreshes both the local deadline and
 * the server's sliding window.
 */

const TIMED_STAGES = new Set(['consent', 'instructions', 'diary', 'tasks']);
const ACTIVITY_THROTTLE_MS = 1000;
const MAX_TOUCH_INTERVAL_MS = 60000;
const MIN_TOUCH_INTERVAL_MS = 1000;
const MAX_CUSTOM_TEXT_LENGTH = 1000;

/** @param {string | undefined | null} stage */
export function isTimedStage(stage) {
  return Boolean(stage && TIMED_STAGES.has(stage));
}

/**
 * @param {{ baseUrl: string, language: string, text?: string }} input
 * @returns {string}
 */
export function buildTimeoutUrl({ baseUrl, language, text }) {
  const url = new URL('timeout.html', baseUrl);
  url.searchParams.set('lang', language);
  if (text) url.searchParams.set('text', text.slice(0, MAX_CUSTOM_TEXT_LENGTH));
  return url.toString();
}

/**
 * @param {any} session
 * @param {string} language
 * @returns {string}
 */
export function customTimeoutText(session, language) {
  const map = session?.inactivity_page_custom_text;
  if (!map || typeof map !== 'object') return '';
  return (
    map[language] ||
    map[session.default_language] ||
    map.en ||
    ''
  );
}

/**
 * @param {{
 *   api: {
 *     startSession: () => Promise<any>,
 *     touchSession: () => Promise<any>,
 *     endSession: () => Promise<void>,
 *   } | null,
 *   getLanguage: () => string,
 *   getSession: () => any,
 *   onExpire?: (url: string) => void,
 *   documentRef?: Document,
 *   now?: () => number,
 *   setTimeoutFn?: (handler: () => void, timeout: number) => any,
 *   clearTimeoutFn?: (handle: any) => void,
 * }} deps
 */
export function createSessionLifecycle({
  api,
  getLanguage,
  getSession,
  onExpire = (url) => window.location.replace(url),
  documentRef = document,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let timeoutMs = 0;
  let deadline = 0;
  /** @type {any} */
  let timer = null;
  let listening = false;
  let active = false;
  let hasSession = false;
  let expiring = false;
  let lastActivityAt = 0;
  let lastTouchAt = 0;

  const onActivity = () => noteActivity();
  const onVisibility = () => {
    if (documentRef.visibilityState !== 'visible') return;
    if (active && now() >= deadline) {
      expire();
      return;
    }
    noteActivity(true);
  };

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function attach() {
    if (listening || !documentRef?.addEventListener) return;
    listening = true;
    for (const event of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) {
      documentRef.addEventListener(event, onActivity, { passive: true, capture: true });
    }
    documentRef.addEventListener('visibilitychange', onVisibility);
  }

  function detach() {
    if (!listening || !documentRef?.removeEventListener) return;
    listening = false;
    for (const event of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll']) {
      documentRef.removeEventListener(event, onActivity, { capture: true });
    }
    documentRef.removeEventListener('visibilitychange', onVisibility);
  }

  function arm() {
    clearTimer();
    deadline = now() + timeoutMs;
    timer = setTimeoutFn(expire, timeoutMs);
  }

  function touchIntervalMs() {
    return Math.max(
      MIN_TOUCH_INTERVAL_MS,
      Math.min(MAX_TOUCH_INTERVAL_MS, timeoutMs / 3)
    );
  }

  function maybeTouch() {
    if (!api) return;
    const moment = now();
    if (moment - lastTouchAt < touchIntervalMs()) return;
    lastTouchAt = moment;
    void api.touchSession().catch(() => {
      // The shared API hook handles session 401s; other failures simply let the
      // next real request decide, which keeps the diary usable offline-ish.
    });
  }

  /** @param {boolean} [force] */
  function noteActivity(force = false) {
    if (!active || expiring) return;
    const moment = now();
    if (!force && moment - lastActivityAt < ACTIVITY_THROTTLE_MS) return;
    lastActivityAt = moment;
    arm();
    maybeTouch();
  }

  function stop() {
    active = false;
    clearTimer();
    detach();
  }

  function expire() {
    if (expiring) return;
    expiring = true;
    stop();
    const session = getSession();
    const language = getLanguage();
    const url = buildTimeoutUrl({
      baseUrl: documentRef.baseURI,
      language,
      text: customTimeoutText(session, language),
    });
    void api?.endSession();
    onExpire(url);
  }

  return {
    /** @param {any} session The latest study-config payload. */
    sync(session) {
      if (!api || !session || expiring) return;
      const minutes = Number(session.inactivity_timeout_minutes) || 0;
      if (minutes <= 0) {
        stop();
        if (hasSession) {
          hasSession = false;
          void api.endSession();
        }
        return;
      }
      if (!isTimedStage(session.stage)) {
        stop();
        return;
      }
      if (!hasSession) {
        // Boot already started the session before an external-task return; this
        // second, idempotent start covers a config that turns the timeout on
        // while the tab is open.
        hasSession = true;
        void api.startSession().catch(() => {
          // A 401/403 is handled by the API hook or the stage machine.
        });
      }
      timeoutMs = minutes * 60000;
      active = true;
      lastTouchAt = now();
      lastActivityAt = now();
      attach();
      arm();
    },

    /** Exposed for tests and for the visibility hook. */
    noteActivity,
    expire,

    destroy() {
      stop();
      expiring = true;
    },
  };
}

// @ts-check
/**
 * The usability-signal transport: buffer, flush, and never get in the diary's
 * way.
 *
 * It lives in `data/` because it is the network half of the feature - the rules
 * about *what* may be sent are in `domain/uxEvents.js`. Three properties matter
 * because this runs inside a form people fill in once:
 *  - it does nothing until a session says the study opted in *and* the
 *    participant consented (see `shouldCollectSignals`);
 *  - every send is fire-and-forget: no await, no retry, no error surfaced. A
 *    signal is never worth a lost diary;
 *  - a flush on `pagehide` uses `sendBeacon`, so the last events before a tab
 *    close still arrive.
 */
import { APP_VERSION } from '../domain/appInfo.js';
import {
  FLUSH_THRESHOLD,
  MAX_BUFFERED_EVENTS,
  MAX_EVENTS_PER_BATCH,
  MIN_REPORTED_QUERY,
  buildBatch,
  createLoadId,
  foldQuery,
  isKnownEvent,
  normaliseProps,
  shouldCollectSignals,
  viewportClass,
} from '../domain/uxEvents.js';

const FLUSH_INTERVAL_MS = 15_000;

/**
 * @typedef {{
 *   post: (body: any) => void,
 *   beacon?: (body: any) => void,
 * }} SignalSender
 */

/**
 * The endpoint sender. Study-scoped on purpose: the endpoint takes no
 * participant id, so the rows it creates cannot be joined to research data.
 *
 * @param {string} baseUrl e.g. "/tud_backend/api"
 * @param {string} studyName
 * @returns {SignalSender}
 */
export function createSignalSender(baseUrl, studyName) {
  const url = `${baseUrl}/studies/${encodeURIComponent(studyName)}/ux-events`;
  /** @param {any} body @returns {string} */
  const asJson = (body) => JSON.stringify(body);

  return {
    /** Fire-and-forget: no await, no retry, no error surfaced. */
    post(body) {
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: asJson(body),
        keepalive: true,
      }).catch(() => {});
    },

    /**
     * For the last flush before a tab closes, where `fetch` would be cancelled.
     *
     * @param {any} body
     */
    beacon(body) {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url, new Blob([asJson(body)], { type: 'application/json' }));
        return;
      }
      this.post(body);
    },
  };
}

/**
 * @typedef {{
 *   send: SignalSender | null,
 *   getLanguage?: () => string | null,
 *   getAppVersion?: () => string | null,
 *   now?: () => number,
 *   createId?: () => string,
 *   schedule?: (fn: () => void, ms: number) => any,
 *   cancel?: (handle: any) => void,
 *   addWindowListener?: (type: string, fn: (event: any) => void) => void,
 *   removeWindowListener?: (type: string, fn: (event: any) => void) => void,
 *   addDocumentListener?: (type: string, fn: () => void) => void,
 *   removeDocumentListener?: (type: string, fn: () => void) => void,
 *   viewportWidth?: () => number,
 * }} SignalDeps
 */

/**
 * @param {SignalDeps} deps
 */
export function createSignals({
  send,
  getLanguage = () => null,
  getAppVersion = () => APP_VERSION,
  now = () => Date.now(),
  createId = () => createLoadId(),
  schedule = (fn, ms) => setInterval(fn, ms),
  cancel = (handle) => clearInterval(handle),
  addWindowListener = (type, fn) => window.addEventListener(type, fn),
  removeWindowListener = (type, fn) => window.removeEventListener(type, fn),
  addDocumentListener = (type, fn) => document.addEventListener(type, fn),
  removeDocumentListener = (type, fn) => document.removeEventListener(type, fn),
  viewportWidth = () => window.innerWidth,
}) {
  const loadId = createId();
  /** @type {import('../domain/uxEvents.js').Signal[]} */
  let buffer = [];
  let collecting = false;
  let started = false;
  let reportedStart = false;
  /** @type {any} */
  let timer = null;
  /** @type {string | null} */
  let lastDeadEnd = null;
  /** @type {Array<[string, (event: any) => void]>} */
  const windowHandlers = [];

  /** @param {import('../domain/uxEvents.js').Signal[]} events */
  function ship(events, { beacon = false } = {}) {
    if (!send || !events.length) return;
    for (let offset = 0; offset < events.length; offset += MAX_EVENTS_PER_BATCH) {
      const body = buildBatch({
        loadId,
        language: getLanguage(),
        appVersion: getAppVersion(),
        events: events.slice(offset, offset + MAX_EVENTS_PER_BATCH),
      });
      try {
        if (beacon && send.beacon) send.beacon(body);
        else send.post(body);
      } catch {
        // A signal that cannot be sent is dropped, never retried.
      }
    }
  }

  /** @param {{ beacon?: boolean }} [options] */
  function flush({ beacon = false } = {}) {
    if (!buffer.length) return;
    const events = buffer;
    buffer = [];
    ship(events, { beacon });
  }

  /** @param {string | undefined} url */
  function sourceName(url) {
    if (!url) return 'unknown';
    const name = String(url).split('/').pop() || 'unknown';
    return name.split('?')[0].slice(0, 64);
  }

  /** @param {string} name @param {Record<string, any>} [props] */
  function track(name, props) {
    if (!collecting || !send || !isKnownEvent(name)) return;
    const clean = normaliseProps(name, props);
    /** @type {import('../domain/uxEvents.js').Signal} */
    const event = { name, ts: new Date(now()).toISOString() };
    if (clean) event.props = clean;
    buffer.push(event);
    if (buffer.length > MAX_BUFFERED_EVENTS) buffer = buffer.slice(-MAX_BUFFERED_EVENTS);
    if (buffer.length >= FLUSH_THRESHOLD) flush();
  }

  /** @param {any} event */
  function onError(event) {
    track('client.error', {
      kind: 'js',
      name: String(event?.error?.name || event?.message || 'Error').slice(0, 64),
      source: sourceName(event?.filename),
      line: Number.isInteger(event?.lineno) ? event.lineno : undefined,
    });
  }

  /** @param {any} event */
  function onRejection(event) {
    track('client.error', {
      kind: 'promise',
      name: String(event?.reason?.name || 'UnhandledRejection').slice(0, 64),
      source: 'unknown',
    });
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flush({ beacon: true });
  }

  function onPageHide() {
    flush({ beacon: true });
  }

  function start() {
    if (started) return;
    started = true;
    timer = schedule(() => flush(), FLUSH_INTERVAL_MS);
    /** @type {Array<[string, (event: any) => void]>} */
    const handlers = [
      ['error', onError],
      ['unhandledrejection', onRejection],
    ];
    for (const [type, handler] of handlers) {
      addWindowListener(type, handler);
      windowHandlers.push([type, handler]);
    }
    addDocumentListener('visibilitychange', onVisibilityChange);
    addDocumentListener('pagehide', onPageHide);
  }

  return {
    /** @returns {boolean} */
    get enabled() {
      return collecting;
    },

    /**
     * Learn which stage this page is in. Called on every stage refresh; the
     * collection decision and the `session.started` event happen once per load.
     *
     * @param {any} session The study-config payload.
     */
    onSession(session) {
      if (!shouldCollectSignals(session)) {
        // Dropped rather than kept: nothing from a non-consenting participant
        // may even sit in memory waiting for a later stage.
        collecting = false;
        buffer = [];
        return;
      }
      collecting = true;
      start();
      if (!reportedStart) {
        reportedStart = true;
        track('session.started', {
          stage: session.stage,
          viewport_class: viewportClass(viewportWidth()),
        });
      }
    },

    track,

    /**
     * A dead-end search is only interesting once the participant typed enough to
     * mean something, and only once per term - not once per keystroke.
     *
     * @param {string} query
     * @param {number} hits
     */
    trackSearch(query, hits) {
      if (hits > 0) {
        lastDeadEnd = null;
        return;
      }
      const folded = foldQuery(query);
      if (folded.length < MIN_REPORTED_QUERY || folded === lastDeadEnd) return;
      lastDeadEnd = folded;
      track('search.no_result', { query: folded });
    },

    flush,

    destroy() {
      flush({ beacon: true });
      if (timer !== null) cancel(timer);
      timer = null;
      for (const [type, handler] of windowHandlers) removeWindowListener(type, handler);
      windowHandlers.length = 0;
      removeDocumentListener('visibilitychange', onVisibilityChange);
      removeDocumentListener('pagehide', onPageHide);
      collecting = false;
    },
  };
}

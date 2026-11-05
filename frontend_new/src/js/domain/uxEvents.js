// @ts-check
/**
 * Usability signals: what the client is allowed to report, and how.
 *
 * The feature is opt-in per study (`save_ux_events`) and unlinked by design:
 * there is no participant id anywhere in a signal. What is left is a random id
 * for this page load, kept in memory only (the rewrite has no device storage,
 * D33), so the admin page can count distinct visits.
 *
 * Everything here is pure so the rules can be unit tested: which events exist,
 * which properties they may carry, and how a search term is folded. The server
 * enforces the same catalogue again - this side exists so a mistake fails in a
 * test rather than in a row.
 */

/** Event name -> allowed property keys. Mirrors `ux_events.EVENT_PROPS`. */
export const SIGNAL_PROPS = Object.freeze({
  'session.started': Object.freeze(['stage', 'viewport_class']),
  'activity.form.opened': Object.freeze(['source', 'is_custom_input']),
  'activity.form.closed': Object.freeze([
    'outcome',
    'source',
    'is_custom_input',
    'duration_bucket',
    'had_child_choice',
  ]),
  'diary.blocked': Object.freeze(['stage', 'codes']),
  'search.no_result': Object.freeze(['query']),
  'api.error': Object.freeze(['method', 'route', 'status', 'code']),
  'client.error': Object.freeze(['kind', 'name', 'source', 'line']),
});

/** Closed value sets, so no free text can reach a property that should be a code. */
export const SIGNAL_ENUMS = Object.freeze({
  stage: Object.freeze([
    'consent',
    'instructions',
    'diary',
    'review',
    'done',
    'task',
    'activity_save',
    'multi_day',
    'nudge',
    'study_submit',
  ]),
  viewport_class: Object.freeze(['phone', 'tablet', 'desktop']),
  source: Object.freeze(['search', 'catalogue', 'recent', 'custom', 'edit']),
  outcome: Object.freeze(['saved', 'cancelled', 'deleted']),
  duration_bucket: Object.freeze(['lt10s', '10to30s', '30to60s', '1to3m', 'gt3m']),
  kind: Object.freeze(['js', 'promise']),
  method: Object.freeze(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
});

/** One batch is what the server accepts per request. */
export const MAX_EVENTS_PER_BATCH = 20;

/** Above this the buffer is flushed early, so a crash cannot take it with it. */
export const FLUSH_THRESHOLD = 10;

/** Hard ceiling: a runaway loop must not grow memory without bound. */
export const MAX_BUFFERED_EVENTS = 50;

/** Shortest query worth reporting: one or two letters say nothing about intent. */
export const MIN_REPORTED_QUERY = 3;

export const MAX_QUERY_CHARS = 48;

/**
 * Whether this page load may report signals.
 *
 * Same gate as browser identification, and for the same reason (D38): nothing is
 * collected from someone who has not consented, and nothing is collected on a
 * page that is not part of the study flow.
 *
 * @param {any} session The study-config payload.
 * @returns {boolean}
 */
export function shouldCollectSignals(session) {
  if (!session || session.save_ux_events !== true) return false;
  if (!session.stage) return false;
  if (session.require_consent === true && session.consent_given !== true) return false;
  return true;
}

/**
 * Fold a search term the way the search itself does: case, accents and "ß".
 *
 * The server folds again, so an older client cannot make the admin table split
 * one term into two rows.
 *
 * @param {string} value
 * @returns {string}
 */
export function foldQuery(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\u1e9e/g, 'SS')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_CHARS);
}

/**
 * Which layout tier this width gets (D12: 1200 px is the two-column breakpoint).
 *
 * @param {number} width
 * @returns {'phone' | 'tablet' | 'desktop'}
 */
export function viewportClass(width) {
  if (width < 768) return 'phone';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

/**
 * Coarse time-on-task bucket. Seconds are enough: the question is "did this
 * take a moment or a while", not "how many milliseconds".
 *
 * @param {number} milliseconds
 * @returns {string}
 */
export function durationBucket(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'lt10s';
  if (milliseconds < 10_000) return 'lt10s';
  if (milliseconds < 30_000) return '10to30s';
  if (milliseconds < 60_000) return '30to60s';
  if (milliseconds < 180_000) return '1to3m';
  return 'gt3m';
}

/**
 * A random id for this page load.
 *
 * Canonical UUID shape on purpose: the server rejects anything else, so a
 * participant id can never be smuggled in as a load id.
 *
 * @param {{ randomUUID?: () => string }} [cryptoObj]
 * @returns {string}
 */
export function createLoadId(cryptoObj = /** @type {any} */ (globalThis.crypto)) {
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isKnownEvent(name) {
  return Object.prototype.hasOwnProperty.call(SIGNAL_PROPS, name);
}

/**
 * Keep only what the server would keep, so a stray property never leaves the
 * browser in the first place.
 *
 * @param {string} name
 * @param {Record<string, any> | undefined} props
 * @returns {Record<string, any> | null}
 */
export function normaliseProps(name, props) {
  const allowed = /** @type {Record<string, readonly string[]>} */ (SIGNAL_PROPS)[name];
  if (!allowed || !props) return null;
  /** @type {Record<string, any>} */
  const clean = {};
  for (const key of allowed) {
    if (!(key in props)) continue;
    const value = props[key];
    if (value === undefined || value === null || value === '') continue;
    const allowedValues = /** @type {Record<string, readonly string[]>} */ (SIGNAL_ENUMS)[key];
    if (allowedValues && !allowedValues.includes(String(value))) continue;
    clean[key] = value;
  }
  return Object.keys(clean).length ? clean : null;
}

/**
 * @typedef {{ name: string, ts: string, props?: Record<string, any> }} Signal
 */

/**
 * Build the request body for one batch.
 *
 * @param {{
 *   loadId: string,
 *   language?: string | null,
 *   appVersion?: string | null,
 *   events: Signal[],
 * }} input
 * @returns {{ load_id: string, language?: string, app_version?: string, events: Signal[] }}
 */
export function buildBatch({ loadId, language, appVersion, events }) {
  /** @type {{ load_id: string, language?: string, app_version?: string, events: Signal[] }} */
  const body = { load_id: loadId, events: events.slice(0, MAX_EVENTS_PER_BATCH) };
  if (language) body.language = language;
  if (appVersion) body.app_version = appVersion;
  return body;
}

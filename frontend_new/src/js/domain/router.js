// @ts-check
/**
 * The route table (D37), as pure functions.
 *
 * A route is presentation only. It names a view; it never carries progress, and
 * it never decides anything: the server says which stage a participant is in, and
 * the guard in ui/router.js replaces the URL when the two disagree. That is the
 * whole reason this is a table of six names and not a set of redirects.
 */

export const ROUTE_CONSENT = 'consent';
export const ROUTE_INSTRUCTIONS = 'instructions';
export const ROUTE_DIARY = 'diary';
export const ROUTE_TASKS = 'tasks';
export const ROUTE_THANKS = 'thanks';
export const ROUTE_UNAVAILABLE = 'unavailable';

/** Every route the client can render, in the order a participant meets them. */
export const ROUTES = [
  ROUTE_UNAVAILABLE,
  ROUTE_CONSENT,
  ROUTE_INSTRUCTIONS,
  ROUTE_DIARY,
  ROUTE_TASKS,
  ROUTE_THANKS,
];

/** @type {Record<string, string>} Stage -> route. `done` has two flavours. */
const ROUTE_BY_STAGE = {
  unavailable: ROUTE_UNAVAILABLE,
  consent: ROUTE_CONSENT,
  instructions: ROUTE_INSTRUCTIONS,
  diary: ROUTE_DIARY,
  tasks: ROUTE_TASKS,
  done: ROUTE_THANKS,
};

/**
 * @param {string} stage
 * @returns {string}
 */
export function routeForStage(stage) {
  return ROUTE_BY_STAGE[stage] || ROUTE_UNAVAILABLE;
}

/**
 * Turn a URL hash into a route name. Anything unknown, empty or malformed
 * resolves to null and the caller falls back to the server's stage - a bad URL
 * must never be able to show a page the participant is not allowed to see.
 *
 * @param {string} hash e.g. "#/consent", "#consent", "#/", ""
 * @returns {string | null}
 */
export function parseRoute(hash) {
  const path = String(hash || '')
    .replace(/^#/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!path) return null;
  return ROUTES.includes(path) ? path : null;
}

/**
 * @param {string} route
 * @returns {string} e.g. "#/consent"
 */
export function formatRoute(route) {
  return `#/${route}`;
}

/**
 * Identity travels in the query string; progress never does (D37).
 *
 * @param {string} search e.g. "?study=adult&pid=bernd&lang=de"
 * @returns {{ study: string | null, participant: string | null, language: string | null }}
 */
export function parseIdentity(search) {
  const params = new URLSearchParams(search || '');
  const pick = (/** @type {string} */ key) => params.get(key) || null;
  return {
    study: pick('study'),
    participant: pick('pid'),
    language: pick('lang'),
  };
}

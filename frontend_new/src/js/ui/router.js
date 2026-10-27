// @ts-check
/**
 * The one redirect in the application (D37).
 *
 * `settle(stage)` is called with the stage the server reports. If the URL already
 * names that route, nothing happens. If it does not - a deep link, a stale tab, a
 * participant at the wrong step - the URL is replaced, not pushed, so the back
 * button never leads into a page the participant may not see.
 *
 * Hash routes, deliberately: the app is served from at least three places with
 * different path prefixes (dev nginx, CI, the GH-Pages demo) and the assets in
 * index.html are relative, so pretty path routes would cost a server rule per
 * host before the pilot. Moving to history routes later means changing `apply`
 * and nothing else.
 */
import { formatRoute, parseRoute, routeForStage } from '../domain/router.js';

/**
 * @param {{
 *   onChange: (route: string) => void,
 *   getHash?: () => string,
 *   apply?: (hash: string) => void,
 * }} deps
 */
export function createRouter({ onChange, getHash, apply }) {
  const readHash = getHash || (() => window.location.hash);
  const writeHash =
    apply ||
    ((/** @type {string} */ hash) => {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    });

  /** @type {string | null} */
  let current = null;

  /** @param {string} route */
  function go(route, { replace = true } = {}) {
    current = route;
    const hash = formatRoute(route);
    if (readHash() !== hash) {
      if (replace) writeHash(hash);
      else window.history.pushState(null, '', hash);
    }
    onChange(route);
  }

  /**
   * Point the URL at the stage's route unless it already does.
   *
   * @param {string} stage
   * @returns {string} the route that is now shown
   */
  function settle(stage) {
    const route = routeForStage(stage);
    if (current !== route) go(route);
    return route;
  }

  /**
   * The route the URL asks for, if it asks for one at all.
   *
   * @returns {string | null}
   */
  function requested() {
    return parseRoute(readHash());
  }

  /** @param {() => void} handler */
  function onHashChange(handler) {
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }

  return { go, settle, requested, onHashChange };
}

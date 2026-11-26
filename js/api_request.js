// @ts-check
/**
 * Shared HTTP helpers for API calls made outside the diary bootstrap.
 *
 * Two problems motivated this module:
 *
 * 1. A backend restart (maintenance, deploy, worker recycling) produces short
 *    windows of `502`/`504`/connection errors. The diary tolerates them because
 *    `study_config_manager.js` retries and then falls back to the local studies
 *    file, but the standalone pages (consent, ...) failed on the first attempt
 *    and told the participant to reload.
 * 2. Every failure used to look the same to the UI, so a permanent problem
 *    (invalid/expired participant link, study paused, study already submitted)
 *    was reported as a temporary one ("please try again"), which can never
 *    succeed.
 *
 * Keep the retry policy in one place so both paths behave the same way.
 */

/**
 * @typedef {Object} RetryOptions
 * @property {number} [maxRetries] Number of *additional* attempts (default 2).
 * @property {number} [delayMs] Base backoff delay; grows linearly per attempt.
 * @property {(attempt: number, delay: number, error: Error) => void} [onRetry]
 *   Called before each retry, for logging.
 */

/**
 * `fetch` with a bounded retry for *transient* failures only.
 *
 * Retries network errors (fetch rejects) and `5xx` responses. Client errors
 * (`4xx`) are returned to the caller untouched: they are the caller's to
 * interpret and retrying cannot help. Throws the last error when all attempts
 * fail, exactly like a bare `fetch` would.
 *
 * @param {string} url
 * @param {RequestInit} [options] Passed to `fetch` unchanged on every attempt.
 *   Retried requests must be idempotent (a lost response has to be harmless),
 *   which holds for the calls in this app (config reads, consent updates).
 * @param {RetryOptions} [retryOptions]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const { maxRetries = 2, delayMs = 1200, onRetry = null } = retryOptions;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      // Don't retry on client errors (4xx) - return to caller for handling.
      if (response.status < 500) return response;
      // Retry on server errors (5xx).
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = /** @type {Error} */ (error);
      if (attempt > maxRetries) throw lastError;
      const delay = delayMs * attempt;
      if (onRetry) {
        onRetry(attempt, delay, lastError);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Error codes the pages attach to failures they detect locally (i.e. before a
 * request is even sent). They mean the link/URL is unusable, not that the
 * server is unhappy.
 */
export const NO_STUDIES_AVAILABLE = 'NO_STUDIES_AVAILABLE';
export const STUDY_PARTICIPANT_ID_REQUIRED = 'STUDY_PARTICIPANT_ID_REQUIRED';

/**
 * @typedef {'notFound' | 'unavailable' | 'denied' | 'temporary'} ApiFailureKind
 * - `notFound`    the study does not exist (HTTP 404)
 * - `unavailable` the study is paused or outside its collection window (403
 *                 `study_unavailable`); retrying later may help
 * - `denied`      the participant/link is not valid for this study, or the
 *                 record is locked (400/401/403); retrying never helps
 * - `temporary`   network error or 5xx: the same request may succeed later
 */

/**
 * Classify a failed study API request so the UI can pick a truthful message.
 *
 * @param {unknown} error Error thrown by `fetch`/`fetchWithRetry`, or by the
 *   page's own URL validation (carrying a `code`, see the constants above).
 * @returns {ApiFailureKind}
 */
export function classifyApiFailure(error) {
  if (!error || typeof error !== 'object') return 'temporary';
  const candidate = /** @type {{status?: unknown, code?: unknown}} */ (error);
  const status = typeof candidate.status === 'number' ? candidate.status : null;
  const code = typeof candidate.code === 'string' ? candidate.code : null;

  if (status === 404) return 'notFound';
  if (status === 403) {
    return code === 'study_unavailable' ? 'unavailable' : 'denied';
  }
  if (status === 400 || status === 401 || status === 422) return 'denied';

  if (
    code === NO_STUDIES_AVAILABLE ||
    code === STUDY_PARTICIPANT_ID_REQUIRED ||
    code === 'STUDY_ACCESS_DENIED'
  ) {
    return 'denied';
  }

  // Network failures (TypeError from fetch) and 5xx both land here.
  return 'temporary';
}

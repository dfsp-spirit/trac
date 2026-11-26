// @ts-check
/**
 * Shared HTTP plumbing for the data layer. Only this layer talks to the
 * network; callers see plain payloads or an `ApiError` carrying the backend's
 * machine-readable code.
 */

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, code?: string | null, detail?: unknown }} info
   */
  constructor(message, info) {
    super(message);
    this.name = 'ApiError';
    this.status = info.status;
    this.code = info.code ?? null;
    this.detail = info.detail ?? null;
  }
}

/** @param {unknown} detail @returns {string | null} */
function codeFromDetail(detail) {
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const code = /** @type {{ code?: unknown }} */ (detail).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** @param {string | null} code */
export function isSessionErrorCode(code) {
  return (
    code === 'session.required' ||
    code === 'session.expired' ||
    code === 'session.invalid'
  );
}

/**
 * @param {string} baseUrl e.g. "/tud_backend/api"
 * @param {string} participantId
 * @param {{
 *   onError?: (info: { method: string, route: string, status: number, code?: string | null }) => void,
 *   onSessionExpired?: (info: { code: string }) => void,
 * }} [hooks]
 * @returns {(url: string, options?: RequestInit) => Promise<any>}
 */
export function createRequest(
  baseUrl,
  participantId,
  { onError, onSessionExpired } = {}
) {
  /**
   * The route without the participant id, so nothing that identifies a person
   * can reach an error table.
   *
   * @param {string} url
   * @returns {string}
   */
  function routeOf(url) {
    const withoutQuery = String(url).split('?')[0];
    const route = withoutQuery.startsWith(baseUrl)
      ? withoutQuery.slice(baseUrl.length)
      : withoutQuery;
    return route
      .split(`/participants/${encodeURIComponent(participantId)}`)
      .join('/participants/:pid');
  }

  /**
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  return async function request(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch (error) {
      onError?.({ method, route: routeOf(url), status: 0 });
      throw error;
    }

    if (response.status === 204) return null;

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = payload && typeof payload === 'object' ? payload.detail : null;
      const code = codeFromDetail(detail);
      if (response.status === 401 && isSessionErrorCode(code)) {
        onSessionExpired?.({ code: /** @type {string} */ (code) });
      }
      // A coded 4xx is a rule the participant was told about; only the rest is
      // an error in the sense of "something is broken".
      if (response.status >= 500 || !code) {
        onError?.({ method, route: routeOf(url), status: response.status, code });
      }
      const message =
        (detail && typeof detail === 'object' && 'message' in detail
          ? String(/** @type {{ message?: unknown }} */ (detail).message)
          : null) || `HTTP ${response.status}`;
      throw new ApiError(message, { status: response.status, code, detail });
    }
    return payload;
  };
}

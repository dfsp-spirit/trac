// @ts-check
/**
 * The only module that talks to the network (D33 rule: no fetch outside
 * js/data). It returns plain payloads and throws `ApiError`, which carries the
 * backend's machine-readable `code` so the UI can map one set of messages.
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

/**
 * @param {unknown} detail
 * @returns {string | null}
 */
function codeFromDetail(detail) {
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const code = /** @type {{ code?: unknown }} */ (detail).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/**
 * @param {string} baseUrl e.g. "/tud_backend/api"
 * @param {string} studyName
 * @param {string} participantId
 */
export function createApi(baseUrl, studyName, participantId) {
  const studyRoot = `${baseUrl}/studies/${encodeURIComponent(studyName)}`;
  const diaryRoot = `${studyRoot}/participants/${encodeURIComponent(participantId)}`;

  /**
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });

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
      const message =
        (detail && typeof detail === 'object' && 'message' in detail
          ? String(/** @type {{ message?: unknown }} */ (detail).message)
          : null) || `HTTP ${response.status}`;
      throw new ApiError(message, { status: response.status, code, detail });
    }
    return payload;
  }

  return {
    /** @returns {Promise<import('../domain/diary.js').ApiDiary>} */
    getDiary: () => request(`${diaryRoot}/diary`),

    /**
     * The study's activity catalogue, in the interface language.
     *
     * @param {string} language
     * @returns {Promise<any>}
     */
    getCatalogue: (language) =>
      request(
        `${studyRoot}/activities-config?lang=${encodeURIComponent(language)}` +
          `&participant_id=${encodeURIComponent(participantId)}`
      ),

    /**
     * Everything the client needs to know about this participant's study,
     * including `stage` and `done_reason` (D37).
     *
     * @param {string} language
     * @returns {Promise<any>}
     */
    getStudyConfig: (language) =>
      request(
        `${studyRoot}/study-config?participant_id=${encodeURIComponent(participantId)}` +
          `&lang=${encodeURIComponent(language)}` +
          // Answer with stage "unavailable" and a reason instead of a 403, so the
          // participant is told why the study is not collecting (D39).
          `&include_unavailable=true`
      ),

    /**
     * @param {boolean} given
     * @returns {Promise<{ stage: string }>}
     */
    giveConsent: (given) =>
      request(`${diaryRoot}/consent`, {
        method: 'POST',
        body: JSON.stringify({ consent_given: given }),
      }),

    /** @returns {Promise<{ stage: string }>} */
    completeInstructions: () =>
      request(`${diaryRoot}/instructions/complete`, {
        method: 'POST',
        body: JSON.stringify({ completed: true }),
      }),

    /**
     * Report the device once per load for studies that collect it. The server
     * ignores this when the study's `save_browser_identification` is off, and
     * treats an unchanged snapshot as the same capture.
     *
     * @param {{ user_agent?: string, client_info: Record<string, unknown> }} body
     * @returns {Promise<any>}
     */
    submitClientInfo: (body) =>
      request(`${diaryRoot}/client-info`, {
        method: 'POST',
        body: JSON.stringify(body),
        keepalive: true,
      }),

    /**
     * @param {{ items: any[], group_id?: string, catalogue_version?: string }} body
     * @returns {Promise<any>}
     */
    createActivities: (body) =>
      request(`${diaryRoot}/activities`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    /**
     * @param {string} clientUuid
     * @param {Record<string, unknown>} body
     * @returns {Promise<any>}
     */
    updateActivity: (clientUuid, body) =>
      request(`${diaryRoot}/activities/${encodeURIComponent(clientUuid)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    /** @param {string} clientUuid @returns {Promise<{ deleted: number }>} */
    deleteActivity: (clientUuid) =>
      request(`${diaryRoot}/activities/${encodeURIComponent(clientUuid)}`, {
        method: 'DELETE',
      }),

    /** @param {string} groupId @returns {Promise<{ deleted: number }>} */
    deleteGroup: (groupId) =>
      request(`${diaryRoot}/activity-groups/${encodeURIComponent(groupId)}`, {
        method: 'DELETE',
      }),

    /**
     * Lock the diary. Idempotent, so a retry after a lost response is harmless.
     *
     * @returns {Promise<{ study_submitted_at: string, already_submitted: boolean, stage: string }>}
     */
    submitDiary: () => request(`${diaryRoot}/diary/submit`, { method: 'POST' }),
  };
}

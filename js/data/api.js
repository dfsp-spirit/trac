// @ts-check
/**
 * The only module that talks to the network (D33 rule: no fetch outside
 * js/data). It returns plain payloads and throws `ApiError`, which carries the
 * backend's machine-readable `code` so the UI can map one set of messages.
 */

import { ApiError, createRequest } from './request.js';

export { ApiError } from './request.js';

/**
 * @param {string} baseUrl e.g. "/tud_backend/api"
 * @param {string} studyName
 * @param {string} participantId
 * @param {{
 *   onError?: (info: { method: string, route: string, status: number, code?: string | null }) => void,
 *   onSessionExpired?: (info: { code: string }) => void,
 * }} [hooks] `onError` sees the failures a participant cannot do anything about
 *   (5xx, network, an unmapped 4xx). A 4xx with a machine code is a rule the UI
 *   explains inline, so it is reported as a refusal instead - see
 *   `createDiaryActions`.
 */
export function createApi(
  baseUrl,
  studyName,
  participantId,
  { onError, onSessionExpired } = {}
) {
  const studyRoot = `${baseUrl}/studies/${encodeURIComponent(studyName)}`;
  const diaryRoot = `${studyRoot}/participants/${encodeURIComponent(participantId)}`;
  const request = createRequest(baseUrl, participantId, {
    onError,
    onSessionExpired,
  });

  return {
    /**
     * Start (or resume) the server-side session. Only called when the study's
     * inactivity timeout is greater than zero; a no-op otherwise.
     *
     * @returns {Promise<{ active: boolean, timeout_minutes: number, expires_at?: string | null }>}
     */
    startSession: () => request(`${diaryRoot}/session`, { method: 'POST' }),

    /**
     * Refresh an existing session from user activity. A 401 here means the
     * session already ended and the API hook sends the participant to the
     * timeout page.
     *
     * @returns {Promise<{ active: boolean, timeout_minutes: number, expires_at?: string | null }>}
     */
    touchSession: () => request(`${diaryRoot}/session/touch`, { method: 'POST' }),

    /** @returns {Promise<{ active: boolean, timeout_minutes: number, expires_at?: string | null }>} */
    getSession: () => request(`${diaryRoot}/session`),

    /**
     * Whether the browser actually stored the session cookie. A 401 means it did
     * not (or the session vanished); a network failure is not a cookie verdict.
     *
     * @returns {Promise<boolean>}
     */
    verifySession: async () => {
      try {
        const response = await fetch(`${diaryRoot}/session`, {
          credentials: 'include',
        });
        return response.status !== 401;
      } catch {
        return true;
      }
    },

    /**
     * Best-effort revocation before the timeout page. Deliberately bypasses the
     * shared request helper: the app is already navigating away, and a session
     * 401 must not trigger another redirect.
     *
     * @returns {Promise<void>}
     */
    endSession: async () => {
      try {
        await fetch(`${diaryRoot}/session`, {
          method: 'DELETE',
          credentials: 'include',
          keepalive: true,
        });
      } catch {
        // The timeout page is the important part; revocation is best effort.
      }
    },

    /**
     * @param {{ singleTimeline?: boolean }} [options] `singleTimeline` asks for
     *   the one timeline this diary uses, which is the app's mode (D1).
     * @returns {Promise<import('../domain/diary.js').ApiDiary>}
     */
    getDiary: ({ singleTimeline = false } = {}) =>
      request(`${diaryRoot}/diary${singleTimeline ? '?timelines=resolved' : ''}`),

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
     * Redeem the confirmation a provider returned the participant with
     * (`docs/external-tasks-v2-spec.md` §5).
     *
     * Idempotent: the server treats a second confirmation of the same task as a
     * success, so a reload of the callback URL is not an error.
     *
     * @param {{ taskKey: string, assignedToken: string, hmac?: string | null }} input
     * @returns {Promise<{ task_key: string, is_confirmed: boolean }>}
     */
    confirmExternalTask: ({ taskKey, assignedToken, hmac }) =>
      request(`${diaryRoot}/external-tasks/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          task_key: taskKey,
          assigned_token: assignedToken,
          ...(hmac ? { hmac } : {}),
        }),
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
     * Copy one day onto one or more other days (D18). The target days are
     * overwritten; the response carries the rows it created *and* the ones it
     * replaced, which is what makes an undo possible.
     *
     * @param {{ source_day_index: number, target_day_indexes: number[], group_id?: string }} body
     * @returns {Promise<any>}
     */
    copyDay: (body) =>
      request(`${diaryRoot}/day-copies`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    /**
     * Seed an empty proxy questionnaire from a finished sibling's diary.
     *
     * Refused by the server unless the target is empty and the study is a proxy
     * study, so the client can offer it optimistically.
     *
     * @returns {Promise<{ copied: number, group_id: string, source_participant_id: string }>}
     */
    copyPreviousQuestionnaire: () =>
      request(`${diaryRoot}/template-copy`, { method: 'POST' }),

    /**
     * Lock the diary. Idempotent, so a retry after a lost response is harmless.
     *
     * @returns {Promise<{ study_submitted_at: string, already_submitted: boolean, stage: string }>}
     */
    submitDiary: () => request(`${diaryRoot}/diary/submit`, { method: 'POST' }),

    /**
     * Close the diary without filling it (D41). The reason is optional; the
     * server enforces `allow_skip_timeuse` and ignores an unknown code.
     *
     * @param {{ reason_code?: string, reason_note?: string }} body
     * @returns {Promise<any>}
     */
    skipDiary: (body) =>
      request(`${diaryRoot}/diary/skip`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
  };
}

/**
 * The public study list, for the entry page.
 *
 * The one request that names neither a study nor a participant: it asks which
 * studies a visitor may join without an invitation link. It lives here because
 * no other layer may talk to the network (D33), and it takes no participant so
 * opening the page cannot create one.
 *
 * @param {string} baseUrl e.g. "/tud_backend/api"
 * @param {string} [language] interface language for the descriptions
 * @returns {Promise<Array<{ name_short: string, name?: string | null, description?: string | null }>>}
 */
export async function listListedStudies(baseUrl, language) {
  const query = language ? `?lang=${encodeURIComponent(language)}` : '';
  const response = await fetch(`${baseUrl}/listed_public_studies${query}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status}`, { status: response.status });
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

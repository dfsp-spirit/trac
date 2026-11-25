// @ts-check
/**
 * The banner messages of this deployment (D33: only js/data talks to the
 * network).
 *
 * Two messages exist: one from the server admin and one from the study admin.
 * Both are resolved by the server for the requested language, so this module
 * never merges translations itself - it returns the text the banner shows and
 * the opaque `key` the client remembers when the reader dismisses it.
 *
 * Failure is silent: a missing banner is a message the participant never had,
 * not a reason to interrupt a diary. A maintenance notice is not worth an error
 * dialog when the network blips.
 */

/** @typedef {{ text: string, key: string }} BannerMessage */
/** @typedef {{ server: BannerMessage | null, study: BannerMessage | null }} BannerMessages */

/** @type {BannerMessages} */
const NONE = { server: null, study: null };

/**
 * @param {unknown} value
 * @returns {BannerMessage | null}
 */
function normalizeMessage(value) {
  if (!value || typeof value !== 'object') return null;
  const candidate = /** @type {{ text?: unknown, key?: unknown }} */ (value);
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) return null;
  if (typeof candidate.key !== 'string' || !candidate.key) return null;
  return { text: candidate.text, key: candidate.key };
}

/**
 * @param {string} baseUrl e.g. "/tud_backend/api"
 * @param {{ fetchImpl?: typeof fetch }} [hooks]
 */
export function createMessagesClient(baseUrl, { fetchImpl = fetch } = {}) {
  /**
   * @param {{ studyName?: string | null, language?: string | null }} [query]
   * @returns {Promise<BannerMessages>}
   */
  async function getMessages({ studyName = null, language = null } = {}) {
    const params = new URLSearchParams();
    if (studyName) params.set('study_name_short', studyName);
    if (language) params.set('lang', language);
    const query = params.toString();
    const url = `${baseUrl}/messages${query ? `?${query}` : ''}`;

    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return NONE;
      const payload = await response.json();
      return {
        server: normalizeMessage(payload?.server),
        study: normalizeMessage(payload?.study),
      };
    } catch {
      return NONE;
    }
  }

  return { getMessages };
}

/**
 * One-shot form for the banner: the composition root creates no long-lived
 * client, because a banner is fetched once per page and once per language.
 *
 * @param {string} baseUrl
 * @param {{ studyName?: string | null, language?: string | null }} [query]
 * @returns {Promise<BannerMessages>}
 */
export function loadMessages(baseUrl, query = {}) {
  return createMessagesClient(baseUrl).getMessages(query);
}

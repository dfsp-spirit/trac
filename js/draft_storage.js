// @ts-check
/**
 * Local persistence of the diary that is currently being edited (the "pending
 * timeline state").
 *
 * The diary keeps unsaved work in `sessionStorage` (tab-scoped) and
 * `localStorage` (survives a browser restart, so an unfinished day is not lost
 * when the laptop is closed). Nothing here may ever throw: storage can be
 * unavailable or full (Safari private mode, "block all cookies", quota
 * exceeded), and a corrupt or outdated payload from an older app version must
 * be discarded instead of being handed to the timeline.
 *
 * Kept free of DOM/global dependencies so it can be unit tested.
 */

export const PENDING_TIMELINE_STATE_KEY = 'trac.pendingTimelineState.v1';
export const DRAFT_TIMELINE_STATE_KEY = 'trac.timelineDraftState.v1';

/** A draft older than this is not restored (yesterday's leftover work). */
export const DRAFT_TIMELINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} TimelineContext
 * @property {string} pid
 * @property {string} study_name
 * @property {string} day_label_index
 */

/**
 * @typedef {object} TimelineDraft
 * @property {string} pid
 * @property {string} study_name
 * @property {string} day_label_index
 * @property {number} savedAt
 * @property {number} [currentIndex]
 * @property {Array<Record<string, any>>} activities
 */

/**
 * `getItem` that never throws (returns null when storage is unavailable).
 * @param {Storage | undefined | null} storage
 * @param {string} key
 * @returns {string | null}
 */
export function safeGetItem(storage, key) {
  try {
    return storage ? storage.getItem(key) : null;
  } catch (error) {
    console.warn(`Stored value ${key} is unavailable:`, error);
    return null;
  }
}

/**
 * `setItem` that never throws (returns false when the value was not stored).
 * @param {Storage | undefined | null} storage
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function safeSetItem(storage, key, value) {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch (error) {
    // Quota exceeded or storage disabled - the diary keeps working, the draft
    // just cannot be persisted.
    console.warn(`Failed to store ${key}:`, error);
    return false;
  }
}

/**
 * `removeItem` that never throws.
 * @param {Storage | undefined | null} storage
 * @param {string} key
 */
export function safeRemoveItem(storage, key) {
  try {
    storage?.removeItem(key);
  } catch (error) {
    console.warn(`Failed to clear ${key}:`, error);
  }
}

/**
 * Is this a usable draft? Activities without a timeline key cannot be restored.
 * @param {any} payload
 * @returns {TimelineDraft | null}
 */
export function normalizeTimelineState(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const activities = Array.isArray(payload.activities)
    ? payload.activities.filter(
        (activity) =>
          activity &&
          typeof activity === 'object' &&
          typeof activity.timelineKey === 'string' &&
          activity.timelineKey.trim() !== ''
      )
    : [];

  if (activities.length === 0) {
    return null;
  }

  const savedAt = Number(payload.savedAt);

  return {
    pid: typeof payload.pid === 'string' ? payload.pid : '',
    study_name:
      typeof payload.study_name === 'string' ? payload.study_name : '',
    day_label_index:
      typeof payload.day_label_index === 'string'
        ? payload.day_label_index
        : String(payload.day_label_index ?? '0'),
    savedAt: Number.isFinite(savedAt) ? savedAt : 0,
    currentIndex: Number(payload.currentIndex) || 0,
    activities,
  };
}

/**
 * Store the draft in one storage area.
 * @param {Storage | undefined | null} storage
 * @param {string} key
 * @param {any} payload
 * @returns {boolean} whether the payload was written
 */
export function storeTimelineState(storage, key, payload) {
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    console.warn(`Timeline state for ${key} is not serializable:`, error);
    return false;
  }

  return safeSetItem(storage, key, serialized);
}

/**
 * Read and validate a stored draft. Corrupt or unusable payloads are removed so
 * they cannot break every following page load.
 * @param {Storage | undefined | null} storage
 * @param {string} key
 * @returns {TimelineDraft | null}
 */
export function readStoredTimelineState(storage, key) {
  const raw = safeGetItem(storage, key);
  if (!raw) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(
      `Invalid stored timeline state payload for ${key}, clearing it:`,
      error
    );
    safeRemoveItem(storage, key);
    return null;
  }

  const normalized = normalizeTimelineState(parsed);
  if (!normalized) {
    console.warn(
      `Unusable stored timeline state payload for ${key}, clearing it.`
    );
    safeRemoveItem(storage, key);
    return null;
  }

  return normalized;
}

/**
 * Is the draft recent enough to be restored?
 * @param {TimelineDraft | null | undefined} payload
 * @param {number} [now]
 * @returns {boolean}
 */
export function isStoredTimelineStateFresh(payload, now = Date.now()) {
  const savedAt = Number(payload?.savedAt);
  if (!Number.isFinite(savedAt) || savedAt <= 0) {
    return false;
  }

  return now - savedAt <= DRAFT_TIMELINE_MAX_AGE_MS;
}

/**
 * Belongs this draft to the participant/day that is being opened? Drafts are
 * shared by every participant using the same browser (family tablet, lab PC),
 * so a mismatch must never be restored.
 * @param {TimelineDraft | null | undefined} payload
 * @param {TimelineContext} context
 * @returns {boolean}
 */
export function matchesTimelineContext(payload, context) {
  if (!payload || !context) {
    return false;
  }

  return (
    String(payload.pid || '') === String(context.pid || '') &&
    String(payload.study_name || '') === String(context.study_name || '') &&
    String(payload.day_label_index || '0') ===
      String(context.day_label_index || '0')
  );
}

/**
 * Drop both stored copies of the draft.
 * @param {{ sessionStorage?: Storage | null, localStorage?: Storage | null }} storages
 */
export function clearTimelineState(storages = {}) {
  safeRemoveItem(storages.sessionStorage ?? null, PENDING_TIMELINE_STATE_KEY);
  safeRemoveItem(storages.localStorage ?? null, DRAFT_TIMELINE_STATE_KEY);
}

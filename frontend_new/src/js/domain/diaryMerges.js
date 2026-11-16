// @ts-check
/**
 * Merging a write response back into the local diary.
 *
 * Every write is optimistic in the sense that the local diary is updated from
 * the server's answer, never predicted: the backend returns the rows it created,
 * changed or replaced, and those become the local copy. One source of truth (the
 * server), no full reload after an edit.
 *
 * Pure functions on API payloads, kept out of `state/` so the actions stay about
 * *when* to write - and so `state/` does not grow past its size cap.
 */

/**
 * @typedef {import('./diary.js').ApiDiary} ApiDiary
 * @typedef {import('./diary.js').ApiActivity} ApiActivity
 */

/**
 * A create may be retried after a lost response; rows the diary already knows are
 * not added twice.
 *
 * @param {any} result Response of POST /activities
 * @param {ApiDiary} diary
 * @returns {ApiDiary}
 */
export function withCreated(result, diary) {
  /** @type {ApiActivity[]} */
  const created = result?.activities || [];
  const known = new Set(diary.activities.map((activity) => activity.client_uuid));
  const additions = created.filter((activity) => !known.has(activity.client_uuid));
  return { ...diary, activities: [...diary.activities, ...additions] };
}

/**
 * @param {string} clientUuid
 * @param {ApiActivity} updated
 * @param {ApiDiary} diary
 * @returns {ApiDiary}
 */
export function withUpdated(clientUuid, updated, diary) {
  return {
    ...diary,
    activities: diary.activities.map((activity) =>
      activity.client_uuid === clientUuid ? { ...activity, ...updated } : activity
    ),
  };
}

/**
 * @param {Set<string>} uuids
 * @param {ApiDiary} diary
 * @returns {ApiDiary}
 */
export function withoutUuids(uuids, diary) {
  return {
    ...diary,
    activities: diary.activities.filter((activity) => !uuids.has(activity.client_uuid)),
  };
}

/**
 * A copy replaces the target days' own rows. The response is authoritative on
 * both sides of that exchange, so the local diary is rebuilt from it instead of
 * being predicted.
 *
 * @param {any} result Response of POST /day-copies
 * @param {ApiDiary} diary
 * @returns {ApiDiary}
 */
export function withCopied(result, diary) {
  /** @type {ApiActivity[]} */
  const replaced = result?.replaced || [];
  /** @type {ApiActivity[]} */
  const created = result?.activities || [];
  const gone = new Set(replaced.map((activity) => activity.client_uuid));
  const replacedDays = new Set(replaced.map((activity) => activity.day_label_index));
  const createdDays = new Set(created.map((activity) => activity.day_label_index));

  return {
    ...diary,
    activities: [
      ...diary.activities.filter(
        (activity) =>
          !gone.has(activity.client_uuid)
          // A copied target keeps nothing of its own, even if the response and the
          // local diary disagree about which rows those were.
          && !replacedDays.has(activity.day_label_index)
          && !createdDays.has(activity.day_label_index)
      ),
      ...created,
    ],
  };
}

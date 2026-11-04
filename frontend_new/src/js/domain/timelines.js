// @ts-check
/**
 * What the rewrite does with a study that still defines more than one timeline.
 *
 * One timeline per study is the model (D1): the primary/secondary split is gone
 * from the participant UI, and the backend files every write on the timeline the
 * diary resolved to. Studies that still carry a second timeline ("things done in
 * parallel") are in transition, so the deployment names the policy in
 * `config.js` until they are converted:
 *
 *  * `ignore` - offer and read only the resolved timeline. The default, because
 *    it is what the app will do once multi-timeline support is dropped.
 *  * `merge`  - one picker for every timeline, with the timeline-independent
 *    settings taken from the first timeline (not the last, which used to win and
 *    silently reset `min_coverage` to the secondary's 0).
 *  * `error`  - refuse to run, so an unconverted study is reported instead of
 *    being shown wrongly.
 */

/** @typedef {'ignore' | 'merge' | 'error'} MultiTimelinePolicy */

/** @type {readonly MultiTimelinePolicy[]} */
export const MULTI_TIMELINE_POLICIES = ['ignore', 'merge', 'error'];

/**
 * @param {unknown} value
 * @returns {MultiTimelinePolicy}
 */
export function normalizePolicy(value) {
  return MULTI_TIMELINE_POLICIES.includes(/** @type {any} */ (value))
    ? /** @type {MultiTimelinePolicy} */ (value)
    : 'ignore';
}

/** @param {any} catalogue Response of `/activities-config`. */
function timelinesOf(catalogue) {
  const timelines = catalogue && catalogue.timeline;
  return timelines && typeof timelines === 'object' ? timelines : {};
}

/**
 * The timeline a study falls back to when the caller has no resolved key: the
 * same order the backend uses (`_resolve_timeline`), so the two cannot disagree.
 *
 * @param {string[]} keys
 * @returns {string | null}
 */
export function fallbackTimelineKey(keys) {
  if (!keys.length) return null;
  return keys.includes('primary') ? 'primary' : keys[0];
}

/**
 * Which timelines of the catalogue this app should use.
 *
 * @param {any} catalogue Response of `/activities-config`.
 * @param {{ policy?: string | null, timelineKey?: string | null }} [options]
 *   `timelineKey` is the key the diary resolved to (`diary.timeline.key`).
 * @returns {{ keys: string[], error: 'multi_timeline' | null }}
 *   `keys` in config order; `error` set when the study cannot be shown.
 */
export function selectTimelineKeys(catalogue, options = {}) {
  const policy = normalizePolicy(options.policy);
  const keys = Object.keys(timelinesOf(catalogue));
  const resolved = options.timelineKey;
  const single = resolved && keys.includes(resolved) ? resolved : fallbackTimelineKey(keys);

  if (keys.length <= 1) return { keys, error: null };
  if (policy === 'error') return { keys: [], error: 'multi_timeline' };
  if (policy === 'merge') return { keys, error: null };
  return { keys: single ? [single] : [], error: null };
}

/**
 * The timeline keys this app should use, from the payloads it holds.
 *
 * @param {any} catalogue
 * @param {{ timeline?: { key?: string } } | null | undefined} diary
 * @param {string | null | undefined} policy
 * @returns {string[]}
 */
export function timelineKeysFor(catalogue, diary, policy) {
  return selectTimelineKeys(catalogue, {
    policy,
    timelineKey: diary?.timeline?.key ?? null,
  }).keys;
}

/**
 * The timeline-independent settings (`min_coverage`, `max_overlap`) of a study.
 *
 * They are properties of the study, not of a timeline, and a study with several
 * timelines repeats them. Reading the last one made the secondary's
 * `min_coverage: 0` win over the primary's requirement, so the first timeline is
 * authoritative - the same order the backend resolves in.
 *
 * @param {any} catalogue
 * @param {string[]} keys Timelines in the order they should be read.
 * @returns {{ minCoverage: number | null, maxOverlap: number | null }}
 */
export function generalTimelineSettings(catalogue, keys) {
  const timelines = timelinesOf(catalogue);
  const first = timelines[keys[0]];
  if (!first) return { minCoverage: null, maxOverlap: null };
  return {
    minCoverage: typeof first.min_coverage === 'number' ? first.min_coverage : null,
    maxOverlap: typeof first.max_overlap === 'number' ? first.max_overlap : null,
  };
}

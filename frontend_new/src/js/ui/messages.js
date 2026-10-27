// @ts-check
/**
 * Machine code -> translation key. The backend and the domain both report stable
 * codes, never prose, so there is exactly one place that knows which message a
 * participant sees.
 */

/** @type {Record<string, string>} */
export const codes = {
  'time.end_not_after_start': 'diary.error.endBeforeStart',
  'time.too_long': 'diary.error.tooLong',
  'time.not_on_step': 'diary.error.notOnStep',
  'time.start_out_of_range': 'diary.error.startOutOfRange',
  'overlap.limit_reached': 'diary.error.overlap',
  'activity.duplicate': 'diary.error.duplicate',
  'day.ends_at_midnight': 'diary.error.lastMidnight',
  'day.out_of_range': 'diary.error.dayRange',
  'form.chooseOption': 'diary.error.needsOption',
  'form.needsText': 'diary.error.needsText',
  'study_already_submitted': 'diary.error.submitted',
  study_unavailable: 'diary.error.unavailable',
};

/**
 * @param {string | null | undefined} code
 * @returns {string} Translation key prefix; callers append `.title` / `.text`.
 */
export function keyFor(code) {
  return (code && codes[code]) || 'diary.error.generic';
}

/**
 * Turn a machine code into the two strings a notice shows.
 *
 * @param {(key: string, params?: Record<string, string | number>) => string} t
 * @param {string | null | undefined} code
 * @param {Record<string, unknown>} [meta]
 * @returns {{ title: string, text: string }}
 */
export function describeError(t, code, meta = {}) {
  const key = keyFor(code);
  return {
    title: t(`${key}.title`),
    text: t(`${key}.text`, /** @type {Record<string, string | number>} */ (meta)),
  };
}

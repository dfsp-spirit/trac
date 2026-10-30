// @ts-check
/**
 * Skipping the diary (D41).
 *
 * Offered only when the study asks for it (`allow_skip_timeuse`), and only from
 * the diary stage: the point is to let someone stop filling the diary, not to
 * bypass consent or instructions.
 *
 * The decision rules live here so the menu entry and the dialog cannot disagree
 * about when the option exists, and so the copy can be derived from the study
 * config instead of hard-coded: a study that requires the diary before its
 * external tasks must not promise that the tasks stay reachable.
 */

/** @type {{ id: string, key: string }[]} */
export const SKIP_REASON_CODES = [
  { id: 'no_time_and_effort', key: 'diary.skip.reasonNoTimeAndEffort' },
  { id: 'technical_problem', key: 'diary.skip.reasonTechnicalProblem' },
  { id: 'did_not_understand', key: 'diary.skip.reasonDidNotUnderstand' },
  { id: 'do_not_want_to_report', key: 'diary.skip.reasonDoNotWantToReport' },
  { id: 'other', key: 'diary.skip.reasonOther' },
];

/**
 * @typedef {Object} SkipConsequences
 * @property {boolean} tasksContinue  The participant can still do the tasks.
 * @property {boolean} tasksLocked    The tasks stay closed because they need a diary.
 */

/**
 * Whether to offer "skip the diary" for this session.
 *
 * @param {any} session The study-config payload.
 * @param {{ locked?: boolean }} [options]
 * @returns {boolean}
 */
export function canSkipDiary(session, { locked = false } = {}) {
  if (!session || locked) return false;
  if (session.allow_skip_timeuse !== true) return false;
  return session.stage === 'diary';
}

/**
 * What the confirmation must state, derived from the same config the server
 * enforces. Returning both flags (instead of one) keeps the "tasks stay closed"
 * case explicit - it is the one a participant would otherwise be surprised by.
 *
 * @param {any} session The study-config payload.
 * @returns {SkipConsequences}
 */
export function skipConsequences(session) {
  const tasks = Array.isArray(session?.external_tasks) ? session.external_tasks : [];
  const pending = tasks.some((/** @type {any} */ task) => task && task.is_confirmed !== true);

  if (!pending) return { tasksContinue: false, tasksLocked: false };
  if (session.require_diary_before_external_tasks === true) {
    return { tasksContinue: false, tasksLocked: true };
  }
  return { tasksContinue: true, tasksLocked: false };
}

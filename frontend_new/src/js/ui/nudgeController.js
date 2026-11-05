// @ts-check
/**
 * Arrow-key nudging of a focused block (D14, D31).
 *
 * Split out of the panel controller because it is its own behaviour with its own
 * queue: a nudge is a PATCH, and two quick keypresses must not race each other.
 * The rules are the form's rules, so a nudge can never write a range the form
 * would have refused.
 */
import { toTimedActivity } from '../domain/diary.js';
import { nudgeRange } from '../domain/nudge.js';
import { STEP_MINUTES } from '../domain/time.js';
import { validateActivity } from '../domain/validation.js';
import { describeError } from './messages.js';

/**
 * @param {{
 *   getDiary: () => import('../domain/diary.js').ApiDiary,
 *   isLocked: () => boolean,
 *   onUpdate: (clientUuid: string, changes: Record<string, number>) => Promise<any>,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   toast: { show: (message: string) => void },
 *   signals?: { track: (name: string, props?: Record<string, any>) => void },
 * }} deps
 */
export function createNudgeController({ getDiary, isLocked, onUpdate, t, toast, signals }) {
  /** @type {Array<{ uuid: string, mode: 'move' | 'resize', delta: number }>} */
  const queue = [];
  let busy = false;

  /**
   * The save re-renders the timeline, so the focused button is a new node: put
   * the focus back on the same block without moving the page under the finger.
   *
   * This has to happen in the same microtask as the render, not in the next
   * frame: while no block is focused a keypress belongs to nobody, so a second
   * arrow key pressed inside that gap would be swallowed.
   *
   * @param {string} uuid
   */
  function focusBlock(uuid) {
    const selector = `.t-event__btn[data-uuid="${CSS.escape(uuid)}"]`;
    const button = document.querySelector(selector);
    if (button instanceof HTMLElement) button.focus({ preventScroll: true });
  }

  /**
   * @param {{ uuid: string, mode: 'move' | 'resize', delta: number }} job
   */
  async function apply({ uuid, mode, delta }) {
    const diary = getDiary();
    const activity = diary?.activities.find((item) => item.client_uuid === uuid);
    if (!activity) return;

    const dayStart = diary.study.day_start_minutes || 0;
    const current = toTimedActivity(activity, dayStart);
    const next = nudgeRange(current, { mode, delta });
    // Nothing legal in that direction: the block has reached the end of its day
    // or its minimum length. Silent, because a toast per keypress would be noise.
    if (!next) return;

    const result = validateActivity({
      candidate: { ...current, ...next, activityCode: activity.activity_code },
      existing: diary.activities.map((item) => ({
        ...toTimedActivity(item, dayStart),
        activityCode: item.activity_code,
      })),
      dayCount: diary.days.length,
      maxOverlap: diary.timeline.max_overlap,
      ignoreId: activity.client_uuid,
      step: STEP_MINUTES,
    });

    if (!result.ok) {
      signals?.track('diary.blocked', { stage: 'nudge', codes: [result.code] });
      const message = describeError(t, result.code, result.meta || {});
      toast.show(`${message.title} — ${message.text}`);
      return;
    }

    try {
      await onUpdate(uuid, {
        start_minutes: activity.start_minutes + (next.startMinutes - current.startMinutes),
        end_minutes: activity.end_minutes + (next.endMinutes - current.endMinutes),
      });
      focusBlock(uuid);
    } catch (error) {
      const failure = /** @type {{ code?: string, detail?: Record<string, unknown> }} */ (error);
      toast.show(describeError(t, failure.code, failure.detail || {}).title);
    }
  }

  async function drain() {
    if (busy) return;
    busy = true;
    try {
      for (let job = queue.shift(); job; job = queue.shift()) {
        await apply(job);
      }
    } finally {
      busy = false;
    }
  }

  /**
   * A burst on the same block and edge is added up first, so holding the key
   * costs one request per round-trip instead of one per repeat.
   *
   * @param {'move' | 'resize'} mode
   * @param {number} delta Signed minutes.
   * @returns {boolean} Whether the key belonged to a block (so the caller keeps it).
   */
  function nudge(mode, delta) {
    const focused = document.activeElement;
    const uuid = focused instanceof HTMLElement ? focused.dataset.uuid : null;
    if (!uuid || isLocked()) return false;
    if (!getDiary()?.activities.some((item) => item.client_uuid === uuid)) return false;

    const last = queue[queue.length - 1];
    if (last && last.uuid === uuid && last.mode === mode) last.delta += delta;
    else queue.push({ uuid, mode, delta });
    void drain();
    return true;
  }

  return { nudge };
}

// @ts-check
/**
 * Owns the activity panel's lifetime (D29): which host it lives in, when it is
 * created, and what replaces it once the diary is submitted.
 *
 * The composition root used to hold this, and it grew: half of that file was
 * "build the panel, re-host it on a breakpoint, swap it for a read-only note".
 * That is a component's job, so it lives here and main.js only calls it.
 */
import { toTimedActivity, timedActivities } from '../domain/diary.js';
import { nudgeRange } from '../domain/nudge.js';
import { STEP_MINUTES } from '../domain/time.js';
import { validateActivity } from '../domain/validation.js';
import { createActivityPanel } from './activityPanel.js';
import { describeError } from './messages.js';
import { createToast } from './toast.js';

/** The panel still mounts without a participant (the stage machine shows the
 *  failure page); its actions then explain themselves instead of throwing. */
const NO_PARTICIPANT = {
  create: () => Promise.reject(new Error('no participant')),
  update: () => Promise.reject(new Error('no participant')),
  removeWithUndo: () => Promise.reject(new Error('no participant')),
};

/**
 * @param {{
 *   hostPanel: () => HTMLElement | null,
 *   sectionHost: HTMLElement | null,
 *   dialogHost: HTMLDialogElement | null,
 *   isWide: () => boolean,
 *   isLocked: () => boolean,
 *   getDiary: () => import('../domain/diary.js').ApiDiary,
 *   getCatalogue: () => any,
 *   getLanguage: () => string,
 *   actions?: {
 *     create: (body: { items: any[], group_id?: string }) => Promise<any>,
 *     update: (clientUuid: string, changes: Record<string, unknown>) => Promise<any>,
 *     removeWithUndo: (activity: import('../domain/diary.js').ApiActivity) => Promise<() => Promise<void>>,
 *   },
 *   toastRegion: HTMLElement,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} deps
 */
export function createPanelController({
  hostPanel,
  sectionHost,
  dialogHost,
  isWide,
  isLocked,
  getDiary,
  getCatalogue,
  getLanguage,
  actions = NO_PARTICIPANT,
  toastRegion,
  t,
}) {
  /** @type {ReturnType<typeof createActivityPanel> | null} */
  let panel = null;
  let lockedRendered = false;
  // The toast belongs to the panel it reports on, so the panel owner builds it.
  const toast = createToast(toastRegion, {
    undo: () => t('diary.toast.undo'),
    dismiss: () => t('diary.toast.dismiss'),
  });

  /** @param {import('../domain/diary.js').ApiActivity} activity */
  async function deleteWithUndo(activity) {
    const undo = await actions.removeWithUndo(activity);
    toast.show(t('diary.toast.deleted', { name: activity.activity_name }), {
      label: t('diary.toast.undo'),
      run: undo,
    });
  }

  function create() {
    if (isLocked()) {
      // A submitted diary keeps its timeline, not its editor.
      panel = null;
      if (dialogHost?.open) dialogHost.close();
      if (sectionHost) {
        const note = document.createElement('p');
        note.className = 't-hint';
        note.setAttribute('data-i18n', 'diary.notice.locked');
        note.textContent = t('diary.notice.locked');
        sectionHost.replaceChildren(note);
      }
      return;
    }

    const host = hostPanel();
    if (!host) {
      panel = null;
      return;
    }

    panel = createActivityPanel({
      host,
      t,
      language: getLanguage(),
      getDiary,
      getCatalogue,
      onCreate: (body) => actions.create(body),
      onUpdate: (clientUuid, changes) => actions.update(clientUuid, changes),
      onDelete: deleteWithUndo,
      toast,
    });
    panel.showCatalogue();
  }

  /**
   * @param {number} dayIndex
   * @param {number} startRelative
   * @param {number} endRelative
   */
  function openAt(dayIndex, startRelative, endRelative) {
    if (!panel || isLocked()) return;
    if (!isWide() && dialogHost && !dialogHost.open) dialogHost.showModal();
    panel.open({ dayIndex, startMinutes: startRelative, endMinutes: endRelative });
  }

  /** @param {Event} event A click on the timeline: a gap or an activity. */
  function openFromEvent(event) {
    if (isLocked() || !panel) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const gap = target.closest('.t-gap__btn');
    if (gap instanceof HTMLElement) {
      openAt(Number(gap.dataset.day), Number(gap.dataset.start), Number(gap.dataset.end));
      return;
    }

    const button = target.closest('.t-event__btn');
    const uuid = button instanceof HTMLElement ? button.dataset.uuid : null;
    if (!uuid) return;
    const activity = getDiary()?.activities.find((item) => item.client_uuid === uuid);
    if (!activity) return;
    if (!isWide() && dialogHost && !dialogHost.open) dialogHost.showModal();
    panel.openEdit(activity);
  }

  /** @type {Array<{ uuid: string, mode: 'move' | 'resize', delta: number }>} */
  const nudgeQueue = [];
  let nudgeBusy = false;

  /**
   * Arrow keys on one block: shift it, or change its end with Shift (D31).
   *
   * Nudges are queued, not fired: two quick keypresses would otherwise both read
   * the same diary state and the saves could land out of order. A burst on the
   * same block and edge is added up first, so holding the key costs one request
   * per round-trip instead of one per repeat.
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

    const last = nudgeQueue[nudgeQueue.length - 1];
    if (last && last.uuid === uuid && last.mode === mode) last.delta += delta;
    else nudgeQueue.push({ uuid, mode, delta });
    void drainNudges();
    return true;
  }

  async function drainNudges() {
    if (nudgeBusy) return;
    nudgeBusy = true;
    try {
      for (let job = nudgeQueue.shift(); job; job = nudgeQueue.shift()) {
        await applyNudge(job);
      }
    } finally {
      nudgeBusy = false;
    }
  }

  /**
   * Apply one nudge through the same rules and the same PATCH as the form, so a
   * nudge can never write a range the form would have refused.
   *
   * @param {{ uuid: string, mode: 'move' | 'resize', delta: number }} job
   */
  async function applyNudge({ uuid, mode, delta }) {
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
      const message = describeError(t, result.code, result.meta || {});
      toast.show(`${message.title} — ${message.text}`);
      return;
    }

    try {
      await actions.update(uuid, {
        start_minutes: activity.start_minutes + (next.startMinutes - current.startMinutes),
        end_minutes: activity.end_minutes + (next.endMinutes - current.endMinutes),
      });
      focusBlock(uuid);
    } catch (error) {
      const failure = /** @type {{ code?: string, detail?: Record<string, unknown> }} */ (error);
      toast.show(describeError(t, failure.code, failure.detail || {}).title);
    }
  }

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

  return {
    /** Rebuild after a breakpoint change or a submitted/live transition. */
    create,

    /** @param {boolean} locked */
    sync(locked) {
      if (locked === lockedRendered) return;
      lockedRendered = locked;
      create();
    },

    refresh: () => panel?.refresh(),
    openAt,
    openFromEvent,
    nudge,

    /** `/`: the catalogue with the search field focused, in whichever host. */
    focusSearch() {
      if (!panel) return;
      if (!isWide() && dialogHost && !dialogHost.open) dialogHost.showModal();
      panel.focusSearch();
    },

    /** @returns {boolean} Whether the panel consumed the key. */
    escape() {
      return panel ? panel.escape() : false;
    },
  };
}

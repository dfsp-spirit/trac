// @ts-check
/**
 * The diary screen, wired: render the store into the timeline, move between
 * days, and connect the three things a participant taps on the screen itself
 * (the add button, a timeline gap, the submit button).
 *
 * Extracted from the composition root so that file stays a list of parts rather
 * than a list of parts plus their behaviour.
 */
import { copyableDays } from '../domain/dayCopy.js';
import { scrollToDay } from './timeline.js';

/**
 * @param {{
 *   store: { get: () => import('../state/store.js').DiaryState, set: (patch: any) => void },
 *   view: ReturnType<typeof import('./diaryView.js').createDiaryView>,
 *   panels: { sync: (locked: boolean) => void, openAt: (day: number, start: number, end: number) => void,
 *     openHere: (day: number, anchorMinutes: number) => void,
 *     openFromEvent: (event: Event) => void, escape: () => boolean, refresh: () => void },
 *   stageMachine: { incompatible: () => void, setLocked: (locked: boolean) => void },
 *   review: { open: () => void },
 *   daysHost: HTMLElement,
 *   fab: HTMLElement,
 *   submitBtn: HTMLElement,
 *   dialogHost: HTMLDialogElement | null,
 *   isLocked: () => boolean,
 *   copy: { open: (options?: { sourceDay?: number | null }) => void },
 *   copyDaysBtn: HTMLElement | null,
 * }} deps `copy` is the day-copy dialog; the two entry points that live in this
 *   screen ("this day" in a heading, the button under the rail) only report which
 *   day they belong to.
 */
export function createDiaryScreen({
  store,
  view,
  panels,
  stageMachine,
  review,
  daysHost,
  fab,
  submitBtn,
  dialogHost,
  isLocked,
  copy,
  copyDaysBtn,
}) {
  /** @param {number} dayIndex */
  function goToDay(dayIndex) {
    const day = store.get().diary?.days[dayIndex];
    store.set({ currentDay: dayIndex });
    if (day) scrollToDay(view.sections(), day.name);
  }

  /** @param {1 | -1} delta */
  function stepDay(delta) {
    const last = (store.get().diary?.days.length ?? 1) - 1;
    goToDay(Math.min(Math.max(store.get().currentDay + delta, 0), last));
  }

  /** @param {import('../state/store.js').DiaryState} state */
  function render(state) {
    const failure = /** @type {{ code?: string } | null} */ (state.error);
    if (failure?.code === 'multi_timeline') return stageMachine.incompatible();
    if (!state.diary) return;
    const locked = isLocked();
    stageMachine.setLocked(locked);
    view.render({
      diary: state.diary,
      language: state.language,
      revision: state.revision,
      currentDay: state.currentDay,
      locked,
    });
    panels.sync(locked);
    if (copyDaysBtn) {
      const canCopy = !locked && copyableDays(state.diary).length > 0;
      if (canCopy) copyDaysBtn.removeAttribute('aria-disabled');
      else copyDaysBtn.setAttribute('aria-disabled', 'true');
    }
  }

  function addActivity() {
    if (isLocked()) return;
    // An anchor, not a range: "here" is where the participant is looking, and
    // the free-time rule turns it into a range that actually fits the day.
    const dayIndex = store.get().currentDay;
    panels.openHere(dayIndex, view.minutesAtTop(dayIndex));
  }

  function onEscape() {
    if (panels.escape()) return;
    if (dialogHost?.open) dialogHost.close();
  }

  /** @param {Event} event */
  function onTimelineClick(event) {
    const trigger =
      event.target instanceof Element ? event.target.closest('[data-copy-day]') : null;
    if (trigger) {
      const sourceDay = Number(trigger.getAttribute('data-copy-day'));
      if (trigger.getAttribute('aria-disabled') !== 'true') copy.open({ sourceDay });
      return;
    }
    panels.openFromEvent(event);
  }

  function onCopyDays() {
    if (copyDaysBtn?.getAttribute('aria-disabled') === 'true') return;
    copy.open();
  }

  fab.addEventListener('click', addActivity);
  submitBtn.addEventListener('click', review.open);
  daysHost.addEventListener('click', onTimelineClick);
  copyDaysBtn?.addEventListener('click', onCopyDays);

  return {
    render,
    goToDay,
    stepDay,
    addActivity,
    onEscape,
    destroy() {
      fab.removeEventListener('click', addActivity);
      submitBtn.removeEventListener('click', review.open);
      daysHost.removeEventListener('click', onTimelineClick);
      copyDaysBtn?.removeEventListener('click', onCopyDays);
    },
  };
}

// @ts-check
/**
 * The diary screen, wired: render the store into the timeline, move between
 * days, and connect the three things a participant taps on the screen itself
 * (the add button, a timeline gap, the submit button).
 *
 * Extracted from the composition root so that file stays a list of parts rather
 * than a list of parts plus their behaviour.
 */
import { STEP_MINUTES } from '../domain/time.js';
import { scrollToDay } from './timeline.js';

/**
 * @param {{
 *   store: { get: () => import('../state/store.js').DiaryState, set: (patch: any) => void },
 *   view: ReturnType<typeof import('./diaryView.js').createDiaryView>,
 *   panels: { sync: (locked: boolean) => void, openAt: (day: number, start: number, end: number) => void,
 *     openFromEvent: (event: Event) => void, escape: () => boolean, refresh: () => void },
 *   stageMachine: { incompatible: () => void, setLocked: (locked: boolean) => void },
 *   review: { open: () => void },
 *   daysHost: HTMLElement,
 *   fab: HTMLElement,
 *   submitBtn: HTMLElement,
 *   dialogHost: HTMLDialogElement | null,
 *   isLocked: () => boolean,
 * }} deps
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
  }

  function addActivity() {
    if (isLocked()) return;
    const dayIndex = store.get().currentDay;
    const start = view.minutesAtTop(dayIndex);
    panels.openAt(dayIndex, start, Math.min(start + 60, 1440 - STEP_MINUTES));
  }

  function onEscape() {
    if (panels.escape()) return;
    if (dialogHost?.open) dialogHost.close();
  }

  /** @param {Event} event */
  function onTimelineClick(event) {
    panels.openFromEvent(event);
  }

  fab.addEventListener('click', addActivity);
  submitBtn.addEventListener('click', review.open);
  daysHost.addEventListener('click', onTimelineClick);

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
    },
  };
}

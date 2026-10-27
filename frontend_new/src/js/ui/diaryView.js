// @ts-check
/**
 * The diary view: the timeline, the day rail, the phone day selector, the
 * read-only notice and the progress line, rendered together.
 *
 * It exists so that the composition root stays wiring. Everything here is
 * "given this state, show it"; the state itself lives in state/diary.js and is
 * never written from this module - day-in-view is reported back through
 * `onDayInView`, and the caller decides what to do with it.
 */
import { progress } from '../domain/diary.js';
import { STEP_MINUTES } from '../domain/time.js';
import { renderDiaryNotice } from './diaryNotice.js';
import { renderDayNav, watchDayInView } from './dayNav.js';
import { renderDayRail } from './dayRail.js';
import { minutesAtViewportTop, renderTimeline } from './timeline.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */

/**
 * @param {{
 *   root: HTMLElement,
 *   timelineHost: HTMLElement,
 *   railList: HTMLElement,
 *   nav: { prev: HTMLAnchorElement | null, next: HTMLAnchorElement | null, label: HTMLElement | null, meta: HTMLElement | null },
 *   noticesHost: HTMLElement,
 *   progressNote: HTMLElement,
 *   topbar: HTMLElement,
 *   t: Translator,
 *   onDayInView: (index: number) => void,
 *   onTimelineRendered: () => void,
 * }} deps
 */
export function createDiaryView({
  root,
  timelineHost,
  railList,
  nav,
  noticesHost,
  progressNote,
  topbar,
  t,
  onDayInView,
  onTimelineRendered,
}) {
  /** @type {HTMLElement[]} */
  let sections = [];
  /** @type {null | (() => void)} */
  let stopSpy = null;

  /**
   * The timeline is expensive to build and does not depend on which day is in
   * view, so it is only rebuilt when the diary or the language changed. The
   * rail, the selector and the progress line follow every state change.
   *
   * @param {{
   *   diary: import('../domain/diary.js').ApiDiary,
   *   language: string,
   *   revision: number,
   *   currentDay: number,
   *   locked: boolean,
   * }} view
   */
  function render({ diary, language, revision, currentDay, locked }) {
    const upToDate =
      timelineHost.childElementCount > 0 &&
      timelineHost.dataset.language === language &&
      timelineHost.dataset.revision === String(revision);

    if (!upToDate) {
      sections = renderTimeline(timelineHost, { diary, language, t });
      timelineHost.dataset.language = language;
      timelineHost.dataset.revision = String(revision);
      stopSpy?.();
      stopSpy = watchDayInView(sections, topbar, onDayInView);
      onTimelineRendered();
    }

    renderDiaryNotice(noticesHost, { submitted: locked, t });
    renderDayRail(railList, { diary, language, t, currentDay });
    renderDayNav(nav, { diary, language, currentDay, t });
    progressNote.hidden = false;
    progressNote.textContent = t('diary.progress.summary', progress(diary));
  }

  return {
    render,

    /** @returns {HTMLElement[]} */
    sections: () => sections,

    /**
     * A sensible default start for "add activity" when nothing was tapped: the
     * minute currently under the top bar.
     *
     * @param {number} dayIndex
     * @returns {number}
     */
    minutesAtTop: (dayIndex) => minutesAtViewportTop(sections[dayIndex], root, STEP_MINUTES),

    destroy() {
      stopSpy?.();
      stopSpy = null;
    },
  };
}

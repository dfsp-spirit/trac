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
import { timingFor } from '../domain/timing.js';
import { icon } from './dom.js';
import { renderDiaryNotice } from './diaryNotice.js';
import { renderDayNav, watchDayInView } from './dayNav.js';
import { renderDayRail } from './dayRail.js';
import { frequencyLabelLookup } from './activitySearch.js';
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
 *   review: {
 *     button: HTMLElement | null,
 *     open: () => void,
 *   },
 *   onDayInView: (index: number) => void,
 *   onTimelineRendered: () => void,
 * }} deps `review.button` is the top bar's way into the review; it turns black
 *   and says "send" once every day meets its requirement.
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
  review,
  onDayInView,
  onTimelineRendered,
}) {
  /** @type {HTMLElement[]} */
  let sections = [];
  /** @type {import('../domain/diary.js').ApiDiary | null} */
  let lastDiary = null;
  /** @type {boolean | null} */
  let ctaReady = null;
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
   *   catalogue: any,
   * }} view `catalogue` is where the words for a stored frequency key live.
   */
  function render({ diary, language, revision, currentDay, locked, catalogue }) {
    lastDiary = diary;
    const upToDate =
      timelineHost.childElementCount > 0 &&
      timelineHost.dataset.language === language &&
      timelineHost.dataset.revision === String(revision);

    if (!upToDate) {
      sections = renderTimeline(timelineHost, {
        diary,
        language,
        t,
        frequencyLabel: frequencyLabelLookup(catalogue),
      });
      timelineHost.dataset.language = language;
      timelineHost.dataset.revision = String(revision);
      stopSpy?.();
      stopSpy = watchDayInView(sections, topbar, onDayInView);
      onTimelineRendered();
    }

    const done = progress(diary);
    const ready = !locked && done.total > 0 && done.done === done.total;
    renderDiaryNotice(noticesHost, { submitted: locked, ready, t, onReview: review.open });
    renderDayRail(railList, { diary, language, t, currentDay });
    renderDayNav(nav, { diary, language, currentDay, t });
    progressNote.hidden = false;
    progressNote.textContent = t('diary.progress.summary', done);
    renderCta(ready);
  }

  /**
   * The top bar button says "check" until the week can be sent, and then becomes
   * the black action with the word people look for. Only the words and the style
   * change: it always opens the review, so the last step stays confirmed.
   *
   * @param {boolean} ready
   */
  function renderCta(ready) {
    const button = review.button;
    if (!button) return;

    // The label is set here rather than by the document-wide translation pass,
    // because it depends on the state - so it is also refreshed on a language
    // switch, which is the one time the state has not changed.
    const label = button.querySelector('span');
    const text = t(ready ? 'diary.review.ctaReady' : 'diary.shell.submit');
    if (label && label.textContent !== text) label.textContent = text;

    if (ctaReady === ready) return;
    ctaReady = ready;

    button.classList.toggle('t-btn--primary', ready);
    button.classList.toggle('t-btn--secondary', !ready);
    button.dataset.ready = ready ? 'true' : 'false';
    const svg = button.querySelector('svg');
    if (svg) {
      svg.replaceWith(
        icon(
          ready
            ? ['M12 4v11', 'M7 9l5-5 5 5', 'M5 19h14']
            : ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z']
        )
      );
    }
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
    minutesAtTop: (dayIndex) =>
      minutesAtViewportTop(sections[dayIndex], root, timingFor(lastDiary).step),

    destroy() {
      stopSpy?.();
      stopSpy = null;
    },
  };
}

// @ts-check
/**
 * The covered stretches of a day, drawn where they sit.
 *
 * Shared by the day rail and the review so the same week looks the same in
 * both places: the host provides the track (height, radius, background,
 * `position: relative`) and the runs are placed as a share of the 24h day.
 * One node per merged run, so a boundary stays exact at any width.
 *
 * Decorative by contract: every host marks it `aria-hidden`, because the text
 * next to it says whether the day is complete and how much is missing.
 */
import { MINUTES_PER_DAY } from '../domain/time.js';
import { el } from './dom.js';

/**
 * @param {HTMLElement} host
 * @param {Array<{ start: number, end: number }>} runs
 * @returns {void}
 */
export function appendCoverageRuns(host, runs) {
  for (const run of runs) {
    const segment = el('span', 't-coverage__run');
    segment.style.left = `${(run.start / MINUTES_PER_DAY) * 100}%`;
    segment.style.width = `${((run.end - run.start) / MINUTES_PER_DAY) * 100}%`;
    host.append(segment);
  }
}

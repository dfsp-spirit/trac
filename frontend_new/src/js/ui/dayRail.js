// @ts-check
/**
 * Column 1 on desktop (D28): every day with its real coverage, plus which day
 * is currently under the top bar.
 *
 * The numbers come from the same domain functions the timeline uses, so the rail
 * cannot disagree with what is drawn.
 */
import { dayLabel, daySummaries } from '../domain/diary.js';
import { appendCoverageRuns } from './coverageStrip.js';

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string | null} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   diary: import('../domain/diary.js').ApiDiary,
 *   language: string,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   currentDay: number,
 * }} view
 */
export function renderDayRail(host, { diary, language, t, currentDay }) {
  const summaries = daySummaries(diary);
  const required = diary.timeline.min_coverage || 0;
  const fragment = document.createDocumentFragment();

  for (const summary of summaries) {
    const item = el('li');
    const row = el('a', 't-rail__row');
    row.href = `#day-${summary.name}`;
    row.dataset.dayIndex = String(summary.index);
    if (summary.index === currentDay) row.setAttribute('aria-current', 'true');

    const label = dayLabel(summary, language);
    row.append(el('span', 't-rail__day', label));

    const minutes = summary.coverage;
    const state = summary.meets
      ? t('diary.rail.complete')
      : summary.hasData
        ? t('diary.rail.toGo', { minutes: Math.max(0, required - minutes) })
        : t('diary.rail.empty');
    row.append(el('span', 't-rail__min', state));

    // One row per contiguous covered stretch, placed where it sits in the day:
    // the rail shows the day's shape, not a share of a target. The row's text
    // above carries the progress ("complete" / "X min to go"), so the strip is
    // decorative and stays out of the accessibility tree.
    const bar = el('span', 't-rail__bar');
    bar.setAttribute('aria-hidden', 'true');
    appendCoverageRuns(bar, summary.runs);
    row.append(bar);

    // No `aria-label`: the row's own text is its accessible name, and the two
    // must not drift apart. A hand-written label ("Montag, 0 Minuten abgedeckt")
    // is not a superset of what is on screen ("Montag", "leer"), which fails
    // WCAG 2.5.3 - a voice-control user saying "click Montag leer" would not
    // match the control they can see.

    item.append(row);
    fragment.append(item);
  }

  host.replaceChildren(fragment);
}

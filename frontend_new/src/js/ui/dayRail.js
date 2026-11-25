// @ts-check
/**
 * Column 1 on desktop (D28): every day with its real coverage, plus which day
 * is currently under the top bar.
 *
 * The numbers come from the same domain functions the timeline uses, so the rail
 * cannot disagree with what is drawn.
 *
 * EXPERIMENT: the per-day picture is the review's coloured day strip
 * (`ui/dayStrip.js`) instead of the black/white coverage bar, so a week can be
 * scanned for "where did the time go" without opening the review. The old bar
 * and `ui/coverageStrip.js` are kept behind `strip: 'coverage'` for comparison;
 * delete that branch (and coverage.css) if the coloured strip stays.
 */
import { colouredActivities, dayLabel, daySummaries } from '../domain/diary.js';
import { buildDayStrip } from './dayStrip.js';
import { appendCoverageRuns } from './coverageStrip.js';

/**
 * Which per-day picture the rail draws. `'colour'` is the experiment; flipping
 * this back to `'coverage'` is all it takes to compare the two in the app.
 *
 * @type {'colour' | 'coverage'}
 */
export const RAIL_STRIP_DEFAULT = 'colour';

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
 *   strip?: 'colour' | 'coverage',
 * }} view `strip` defaults to `RAIL_STRIP_DEFAULT`; it exists so the component
 *   fixture can render both pictures while the experiment runs.
 */
export function renderDayRail(
  host,
  { diary, language, t, currentDay, strip = RAIL_STRIP_DEFAULT }
) {
  const summaries = daySummaries(diary);
  const required = diary.timeline.min_coverage || 0;
  const records = strip === 'colour' ? colouredActivities(diary) : [];
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

    // One picture per day, placed where the time sits: the rail shows the day's
    // shape, not a share of a target. The row's text above carries the progress
    // ("complete" / "X min to go"), so both pictures are decorative and stay out
    // of the accessibility tree (`buildDayStrip` sets `aria-hidden` itself).
    if (strip === 'colour') {
      // The review's coloured lanes: one row per parallel activity, with the
      // study's own activity colours instead of one black stretch per run.
      row.append(buildDayStrip({ records, dayIndex: summary.index }));
    } else {
      // The previous picture: black covered stretches on a grey track.
      const bar = el('span', 't-rail__bar');
      bar.setAttribute('aria-hidden', 'true');
      appendCoverageRuns(bar, summary.runs);
      row.append(bar);
    }

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

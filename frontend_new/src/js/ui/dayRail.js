// @ts-check
/**
 * Column 1 on desktop (D28): every day with its real coverage, plus which day
 * is currently under the top bar.
 *
 * The numbers come from the same domain functions the timeline uses, so the rail
 * cannot disagree with what is drawn.
 */
import { daySummaries } from '../domain/diary.js';

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

    const label = summary.displayName || summary.name;
    row.append(el('span', 't-rail__day', label));

    const minutes = summary.coverage;
    const state = summary.meets
      ? t('diary.rail.complete')
      : summary.hasData
        ? t('diary.rail.toGo', { minutes: Math.max(0, required - minutes) })
        : t('diary.rail.empty');
    row.append(el('span', 't-rail__min', state));

    const bar = el('span', 't-rail__bar');
    const fill = el('span', 't-rail__fill');
    fill.style.setProperty('--fill', `${Math.min(100, (minutes / 1440) * 100)}%`);
    bar.append(fill);
    row.append(bar);

    row.setAttribute(
      'aria-label',
      t('diary.rail.dayLabel', { day: label, minutes })
    );

    item.append(row);
    fragment.append(item);
  }

  host.replaceChildren(fragment);
}

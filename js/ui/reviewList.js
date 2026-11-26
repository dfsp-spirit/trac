// @ts-check
/**
 * The body of the review step (D32): one compact row per day.
 *
 * The review is a checkpoint, not a second diary. Every entry is already on the
 * timeline, one tap away. What this screen has to answer is "is my week
 * complete, and if not, where should I work next?" - so each day gets its name,
 * its state, the day as the coloured strip the add-activity form draws, and the
 * one largest hole to point at. There is no activity list: it lived here once
 * and made the review a long copy of the page behind it.
 *
 * The strip is the coloured, one-row-per-lane picture rather than a coverage
 * bar: at this size it is just as quick to scan across a week, and it also shows
 * *where* the time went - which is what makes a day that "looks wrong" worth
 * opening at all.
 */
import { buildDayStrip } from './dayStrip.js';

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
 * @param {import('../domain/review.js').ReviewDay} day
 * @param {(key: string, params?: Record<string, string | number>) => string} t
 * @returns {string}
 */
function stateText(day, t) {
  if (day.meets) return t('diary.review.dayComplete');
  if (!day.runs.length) return t('diary.review.dayEmpty');
  return t('diary.review.dayToGo', { minutes: day.minutesToGo });
}

/**
 * @param {import('../domain/review.js').ReviewDay} day
 * @param {{
 *   review: import('../domain/review.js').Review,
 *   clock: (minutes: number) => string,
 *   onEdit: (dayIndex: number) => void,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 * @returns {HTMLElement}
 */
function dayRow(day, { review, clock, onEdit, t }) {
  const section = el('section', 't-review__day');
  if (!day.meets) section.classList.add('t-review__day--open');

  const headingId = `review-day-${day.index}`;
  section.setAttribute('aria-labelledby', headingId);

  const head = el('div', 't-review__head');
  const titles = el('div');
  const heading = el('h2', null, day.label);
  heading.id = headingId;
  titles.append(heading);
  titles.append(el('p', 't-review__state', stateText(day, t)));
  head.append(titles);

  const edit = el('button', 't-review__edit');
  edit.type = 'button';
  edit.append(document.createTextNode(t('diary.review.edit')));
  const spoken = el('span', 't-vh', ` ${day.label}`);
  edit.append(spoken);
  edit.addEventListener('click', () => onEdit(day.index));
  head.append(edit);
  section.append(head);

  // A glance: the state line above says whether the day is enough, so the
  // strip stays out of the accessibility tree and out of the tab order.
  section.append(buildDayStrip({ records: review.records, dayIndex: day.index }));

  // The one hole worth pointing at. A text line, not a control yet: it names
  // the stretch so "where do I continue?" does not need a scroll through the
  // day behind this dialog.
  if (day.largestGap) {
    const gap = el('p', 't-review__gap');
    gap.append(document.createTextNode(`${t('diary.review.largestGap')} `));
    gap.append(
      el(
        'span',
        't-review__gap-range',
        `${clock(day.largestGap.start)} – ${clock(day.largestGap.end)}`
      )
    );
    section.append(gap);
  }

  return section;
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   review: import('../domain/review.js').Review,
 *   clock: (minutes: number) => string,
 *   onEdit: (dayIndex: number) => void,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 */
export function renderReviewList(host, view) {
  const list = el('div', 't-review');
  for (const day of view.review.days) list.append(dayRow(day, view));
  host.replaceChildren(list);
}

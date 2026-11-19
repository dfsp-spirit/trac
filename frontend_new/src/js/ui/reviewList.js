// @ts-check
/**
 * The body of the review step (D32): one compact row per day.
 *
 * The review is a checkpoint, not a second diary. Every entry is already on the
 * timeline, one tap away. What this screen has to answer is "is my week
 * complete, and if not, where should I work next?" - so each day gets its name,
 * its state, the covered stretches as a strip, and the one largest hole to
 * point at. There is no activity list: it lived here once and made the review a
 * long copy of the page behind it.
 */
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
 * @param {HTMLElement} host
 * @param {{
 *   review: import('../domain/review.js').Review,
 *   clock: (minutes: number) => string,
 *   onEdit: (dayIndex: number) => void,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 */
export function renderReviewList(host, { review, clock, onEdit, t }) {
  const list = el('div', 't-review');

  for (const day of review.days) {
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
    // strip stays out of the accessibility tree. Same picture as the day rail.
    const strip = el('div', 't-review__strip');
    strip.setAttribute('aria-hidden', 'true');
    appendCoverageRuns(strip, day.runs);
    section.append(strip);

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

    list.append(section);
  }

  host.replaceChildren(list);
}

// @ts-check
/**
 * The body of the review step (D32): one section per day, its activities in
 * time order, and an *Edit* link back to that day.
 *
 * Minimal on purpose. One row per activity: swatch, time range, name. The point
 * is "yes, that's my week", not a report - no totals, no durations, no charts.
 */

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
  if (!day.rows.length) return t('diary.review.dayEmpty');
  return t('diary.review.dayToGo', { minutes: day.minutesToGo });
}

/**
 * @param {import('../domain/review.js').ReviewRow} row
 * @param {(minutes: number) => string} clock Formats a day-relative minute.
 * @param {(key: string) => string} t
 * @returns {HTMLLIElement}
 */
function renderRow(row, clock, t) {
  const item = el('li');

  const swatch = el('span', 't-pat t-pat--sm');
  swatch.setAttribute('aria-hidden', 'true');
  if (row.color) swatch.style.background = row.color;
  else swatch.classList.add('t-pat--general');
  item.append(swatch);

  const time = el('span', 't-review__time');
  time.textContent = `${clock(row.start)} – ${clock(row.end)}`;
  if (row.nextDay) {
    time.append(el('small', null, ` ${t('diary.review.nextDay')}`));
  }
  item.append(time);

  const what = el('span', 't-review__what', row.name);
  if (row.detail) what.append(el('small', null, row.detail));
  item.append(what);

  return item;
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

    if (day.rows.length) {
      const ordered = el('ol');
      for (const row of day.rows) ordered.append(renderRow(row, clock, t));
      section.append(ordered);
    }

    list.append(section);
  }

  host.replaceChildren(list);
}

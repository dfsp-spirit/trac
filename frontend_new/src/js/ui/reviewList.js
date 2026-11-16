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
 * One line per row of the day, in the timeline's order: the entry, the stretch
 * with nothing in it, or what is left of the night before.
 *
 * @param {import('../domain/review.js').ReviewRow} row
 * @param {(minutes: number) => string} clock Formats a day-relative minute.
 * @param {(key: string, params?: Record<string, string | number>) => string} t
 * @returns {HTMLLIElement}
 */
function renderRow(row, clock, t) {
  const item = el('li', row.kind === 'activity' ? null : `t-review__row--${row.kind}`);

  // A gap has nothing to show in the swatch column; the empty cell keeps the
  // three columns aligned.
  const swatch = el('span');
  if (row.kind !== 'gap') {
    swatch.className = 't-pat t-pat--sm';
    swatch.setAttribute('aria-hidden', 'true');
    if (row.color) swatch.style.background = row.color;
    else swatch.classList.add('t-pat--general');
  }
  item.append(swatch);

  const time = el('span', 't-review__time');
  // The range is one unbreakable piece; "(next day)" may wrap under it, which is
  // the only way a night entry fits the column at 320px.
  const range = el('span', 't-review__range');
  if (row.kind === 'continued') {
    // The same cue the timeline uses for a block that reaches in from the day
    // before; the words in the text column carry it for a screen reader.
    const up = el('span', null, '↑ ');
    up.setAttribute('aria-hidden', 'true');
    range.append(up);
  }
  range.append(document.createTextNode(`${clock(row.start)} – ${clock(row.end)}`));
  time.append(range);
  if (row.nextDay) {
    time.append(el('small', null, ` ${t('diary.review.nextDay')}`));
  }
  item.append(time);

  const what = el('span', 't-review__what');
  if (row.kind === 'gap') {
    what.textContent = t('diary.review.nothingAdded');
  } else {
    what.textContent = row.name;
    if (row.kind === 'continued') {
      what.append(el('span', 't-review__note', ` (${t('diary.review.continued')})`));
    }
  }
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

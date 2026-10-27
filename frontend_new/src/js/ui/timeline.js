// @ts-check
/**
 * The continuous day timeline (D3, D5, D6).
 *
 * Renders every day of the study one after another; positions come from
 * CSS custom properties, so there is no layout script (the design-system rule).
 * The data decisions - which segment belongs to which day, lanes, gaps - are all
 * in domain/geometry.js; this file only turns them into elements.
 */
import { layoutForDay } from '../domain/diary.js';
import { formatClock } from '../domain/time.js';
import { isColour, readableInk } from '../domain/color.js';

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translator */

const HOUR_MARKERS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);

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
 * @param {string} dayName
 * @returns {string}
 */
function dayAnchor(dayName) {
  return `day-${dayName}`;
}

/**
 * @param {import('../domain/diary.js').ApiActivity} activity
 * @param {import('../domain/geometry.js').DaySegment} segment
 * @param {number} dayStart
 * @param {Translator} t
 * @returns {HTMLElement}
 */
function renderEvent(activity, segment, dayStart, t) {
  const start = segment.start;
  const end = segment.end;
  const duration = end - start;
  const continuesAfter = segment.continuesAfter;
  const continuesBefore = segment.continuesBefore;

  const item = el('li', 't-event');
  if (duration <= 45) item.classList.add('t-event--short');
  if (continuesAfter) item.classList.add('t-event--cont-after');
  if (continuesBefore) item.classList.add('t-event--cont-before');
  let vars = `--start-min:${start};--dur-min:${duration}`;
  if (segment.laneCount > 1) {
    vars += `;--lane:${segment.lane};--lanes:${segment.laneCount}`;
    if (duration <= 45) item.classList.add('t-event--narrow');
  }
  item.style.cssText = vars;

  const button = el('button', 't-event__btn');
  button.type = 'button';
  button.dataset.uuid = activity.client_uuid;

  const top = el('span', 't-event__top');
  if (isColour(activity.color)) {
    item.style.setProperty('--event-fill', String(activity.color));
    item.style.setProperty('--event-ink', readableInk(activity.color));
    const swatch = el('span', 't-pat t-pat--sm');
    swatch.style.background = String(activity.color);
    swatch.style.borderColor = String(activity.color);
    swatch.setAttribute('aria-hidden', 'true');
    top.append(swatch);
  }
  top.append(el('span', 't-event__title', activity.activity_name));

  const range = `${formatClock(start, dayStart)} – ${formatClock(end, dayStart)}`;
  const time = el('span', 't-event__time');
  if (continuesBefore) {
    const arrow = el('span', null, '↑ ');
    arrow.setAttribute('aria-hidden', 'true');
    time.append(arrow);
  }
  time.append(range);
  if (continuesAfter) {
    time.append(' ');
    const nextDay = el('span', null, '↓');
    nextDay.setAttribute('aria-hidden', 'true');
    time.append(nextDay, el('span', 't-vh', t('diary.timeline.continuesNextDay')));
  }

  button.append(top, time);
  button.setAttribute(
    'aria-label',
    `${activity.activity_name}, ${range}${continuesAfter ? `, ${t('diary.timeline.continuesNextDay')}` : ''}`
  );
  item.append(button);
  return item;
}

/**
 * @param {number} start
 * @param {number} end
 * @param {number} dayIndex
 * @param {number} dayStart
 * @param {Translator} t
 * @returns {HTMLElement}
 */
function renderGap(start, end, dayIndex, dayStart, t) {
  const item = el('li', 't-gap');
  item.style.cssText = `--start-min:${start};--dur-min:${end - start}`;

  const button = el('button', 't-gap__btn');
  button.type = 'button';
  button.dataset.day = String(dayIndex);
  button.dataset.start = String(start);
  button.dataset.end = String(end);
  button.append(
    t('diary.timeline.gap', {
      start: formatClock(start, dayStart),
      end: formatClock(end, dayStart),
    })
  );
  item.append(button);
  return item;
}

/**
 * @param {import('../domain/diary.js').ApiDiary} diary
 * @param {import('../domain/diary.js').ApiDiary['days'][number]} day
 * @param {Translator} t
 * @param {string} language
 * @returns {HTMLElement}
 */
function renderDay(diary, day, t, language) {
  const dayStart = diary.study.day_start_minutes || 0;
  const layout = layoutForDay(diary, day.index);
  const byUuid = new Map(diary.activities.map((activity) => [activity.client_uuid, activity]));

  const section = el('section', 't-timeline-day');
  section.id = dayAnchor(day.name);
  section.dataset.dayIndex = String(day.index);

  const heading = el('h2', 't-timeline-day__head');
  heading.id = `h-${day.name}`;
  const label =
    (day.display_names && day.display_names[language]) || day.display_name || day.name;
  heading.textContent = label;
  section.setAttribute('aria-labelledby', heading.id);

  const grid = el('div', 't-timeline-grid');
  const hours = el('ol', 't-timeline-hours');
  hours.setAttribute('aria-hidden', 'true');
  for (const marker of HOUR_MARKERS) {
    const item = el('li');
    const time = el('time', null, marker);
    item.append(time);
    hours.append(item);
  }

  const track = el('ol', 't-timeline-track');
  track.setAttribute('aria-label', t('diary.timeline.dayActivities', { day: label }));

  /** @type {Array<[number, HTMLElement]>} */
  const items = [];
  for (const segment of layout.segments) {
    const activity = byUuid.get(segment.record.id);
    if (!activity) continue;
    items.push([
      segment.start,
      renderEvent(activity, segment, dayStart, t),
    ]);
  }
  if (!diary.study.submitted_at) {
    for (const gap of layout.gaps) {
      items.push([gap.start, renderGap(gap.start, gap.end, day.index, dayStart, t)]);
    }
  }
  items.sort((a, b) => a[0] - b[0]);
  for (const [, node] of items) track.append(node);

  grid.append(hours, track);
  section.append(heading, grid);
  return section;
}

/**
 * Render every day into `host` and return the sections for the scroll spy.
 *
 * @param {HTMLElement} host
 * @param {{
 *   diary: import('../domain/diary.js').ApiDiary,
 *   language: string,
 *   t: Translator,
 * }} view
 * @returns {HTMLElement[]}
 */
export function renderTimeline(host, { diary, language, t }) {
  const fragment = document.createDocumentFragment();
  for (const day of diary.days) {
    fragment.append(renderDay(diary, day, t, language));
  }
  host.replaceChildren(fragment);
  return Array.from(host.querySelectorAll('.t-timeline-day'));
}

/**
 * The day-relative minute at the top of the viewport, snapped to the step. This
 * is what the "add activity" action prefills with, so the dialog opens where the
 * participant is looking.
 *
 * @param {HTMLElement | undefined} section
 * @param {HTMLElement} appRoot
 * @param {number} step
 * @returns {number}
 */
export function minutesAtViewportTop(section, appRoot, step) {
  const track = section?.querySelector('.t-timeline-track');
  if (!track) return 8 * 60;
  const hourPx = parseFloat(getComputedStyle(appRoot).getPropertyValue('--hour-row')) || 64;
  const offset = Math.max(0, -track.getBoundingClientRect().top);
  const minutes = (offset / hourPx) * 60;
  return Math.min(1440 - step, Math.floor(minutes / step) * step);
}

/**
 * Scroll a day's heading into view, under the sticky top bar.
 *
 * @param {HTMLElement[]} sections
 * @param {string} dayName
 * @returns {boolean}
 */
export function scrollToDay(sections, dayName) {
  const target = sections.find((section) => section.id === dayAnchor(dayName));
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

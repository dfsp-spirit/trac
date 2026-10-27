// @ts-check
/**
 * The phone day selector in the top bar (D3): previous and next day, the day in
 * view, and "Day 2 of 7".
 *
 * The day in view follows the scroll position, not the other way round; that is
 * what makes the continuous timeline feel like one document with markers rather
 * than seven pages.
 */

/**
 * @param {{
 *   prev: HTMLAnchorElement | null,
 *   next: HTMLAnchorElement | null,
 *   label: HTMLElement | null,
 *   meta: HTMLElement | null,
 * }} nodes
 * @param {{
 *   diary: import('../domain/diary.js').ApiDiary,
 *   language: string,
 *   currentDay: number,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 */
export function renderDayNav(nodes, { diary, language, currentDay, t }) {
  const days = diary.days;
  if (!days.length) return;
  const index = Math.min(Math.max(currentDay, 0), days.length - 1);
  const day = days[index];

  if (nodes.label) {
    nodes.label.textContent =
      (day.display_names && day.display_names[language]) || day.display_name || day.name;
  }
  if (nodes.meta) {
    nodes.meta.textContent = t('diary.nav.position', {
      current: index + 1,
      total: days.length,
    });
  }

  const prevDay = days[index - 1];
  const nextDay = days[index + 1];
  const pairs = [
    { anchor: nodes.prev, target: prevDay },
    { anchor: nodes.next, target: nextDay },
  ];
  for (const { anchor, target } of pairs) {
    if (!anchor) continue;
    if (target) {
      anchor.href = `#day-${target.name}`;
      anchor.removeAttribute('aria-disabled');
      anchor.removeAttribute('tabindex');
    } else {
      anchor.href = '#';
      anchor.setAttribute('aria-disabled', 'true');
      anchor.setAttribute('tabindex', '-1');
    }
  }
  if (nodes.prev) nodes.prev.setAttribute('aria-label', t('diary.nav.previous'));
  if (nodes.next) nodes.next.setAttribute('aria-label', t('diary.nav.next'));
}

/**
 * Which day heading is currently under the sticky bar.
 *
 * @param {HTMLElement[]} sections
 * @param {HTMLElement} bar
 * @returns {number}
 */
export function dayUnderBar(sections, bar) {
  const limit = bar.getBoundingClientRect().bottom;
  let index = 0;
  sections.forEach((section, position) => {
    if (section.getBoundingClientRect().top <= limit + 1) index = position;
  });
  return index;
}

/**
 * Call `onChange` whenever the day in view changes. Returns an unsubscribe.
 *
 * A scroll listener rather than IntersectionObserver: the day in view is "the
 * last heading above the bar", which an observer with a zero-height root margin
 * does not express, and this is ~10 lines.
 *
 * @param {HTMLElement[]} sections
 * @param {HTMLElement} bar
 * @param {(index: number) => void} onChange
 * @returns {() => void}
 */
export function watchDayInView(sections, bar, onChange) {
  let last = -1;
  const update = () => {
    const index = dayUnderBar(sections, bar);
    if (index !== last) {
      last = index;
      onChange(index);
    }
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
  return () => {
    window.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
  };
}

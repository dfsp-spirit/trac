// @ts-check
/**
 * The catalogue list in the activity panel (D29, D30).
 *
 * A flat list grouped by category headings - no accordions, so every main
 * activity is one scroll away - and only the list is replaced when the query
 * changes. The search input itself lives in the panel head and is never
 * re-rendered, which is what keeps focus in it while typing.
 */
import { filterEntries, groupByCategory } from './activitySearch.js';

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
 *   entries: import('./activitySearch.js').CatalogueEntry[],
 *   recents?: import('./activitySearch.js').CatalogueEntry[],
 *   query: string,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   onChoose: (entry: import('./activitySearch.js').CatalogueEntry) => void,
 * }} view
 */
export function renderActivityList(host, { entries, recents = [], query, t, onChoose }) {
  const matches = filterEntries(entries, query);
  const fragment = document.createDocumentFragment();

  /**
   * One row: swatch, name, optional examples, chevron for entries with options.
   * @param {import('./activitySearch.js').CatalogueEntry} entry
   * @returns {HTMLLIElement}
   */
  function row(entry) {
    const item = el('li');
    const button = el('button', 't-activity');
    button.type = 'button';
    button.dataset.activityCode = String(entry.code);

    const swatch = el('span', 't-pat');
    swatch.setAttribute('aria-hidden', 'true');
    if (entry.color) swatch.style.background = entry.color;
    else swatch.classList.add('t-pat--general');
    button.append(swatch);

    const body = el('span', 't-activity__body');
    body.append(el('span', 't-activity__title', entry.name));
    if (entry.examples) body.append(el('span', 't-activity__hint', entry.examples));
    button.append(body);

    if (entry.children.length) {
      const end = el('span', 't-activity__end');
      end.setAttribute('aria-hidden', 'true');
      end.textContent = '›';
      button.append(end);
    }

    button.addEventListener('click', () => onChoose(entry));
    item.append(button);
    return item;
  }

  /**
   * @param {string} heading
   * @param {import('./activitySearch.js').CatalogueEntry[]} items
   */
  function group(heading, items) {
    const section = el('section', 't-activity-group');
    section.append(el('h3', null, heading));
    const list = el('ul', 't-activity-list');
    for (const entry of items) list.append(row(entry));
    section.append(list);
    fragment.append(section);
  }

  if (!matches.length) {
    const empty = el('p', 't-hint');
    empty.textContent = t('diary.panel.noMatches', { query });
    host.replaceChildren(empty);
    return matches.length;
  }

  // The shortcut row sits above the catalogue, but only while the participant is
  // not searching: with a query, the matches are the whole answer.
  if (recents.length) group(t('diary.panel.recent'), recents);
  for (const [category, items] of groupByCategory(matches)) group(category, items);

  host.replaceChildren(fragment);
  return matches.length;
}

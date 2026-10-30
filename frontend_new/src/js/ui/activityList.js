// @ts-check
/**
 * The catalogue list in the activity panel (D29, D30).
 *
 * A flat list grouped by category headings - no accordions, so every main
 * activity is one scroll away - and only the list is replaced when the query
 * changes. The search input itself lives in the panel head and is never
 * re-rendered, which is what keeps focus in it while typing.
 */
import { searchHits } from './activitySearch.js';

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
 *   onChoose: (
 *     entry: import('./activitySearch.js').CatalogueEntry,
 *     child?: { code: number, name: string } | null
 *   ) => void,
 * }} view
 */
export function renderActivityList(host, { entries, recents = [], query, t, onChoose }) {
  const hits = searchHits(entries, query);
  const fragment = document.createDocumentFragment();

  /**
   * One row: swatch, name, a hint, chevron for entries with options.
   *
   * A matched sub-activity is its own row: the child name is the title and the
   * parent becomes the hint, so the participant sees what matched and lands in
   * the form with that sub-activity already chosen.
   *
   * @param {import('./activitySearch.js').SearchHit} hit
   * @returns {HTMLLIElement}
   */
  function row({ entry, child }) {
    const item = el('li');
    const button = el('button', 't-activity');
    button.type = 'button';
    button.dataset.activityCode = String(child ? child.code : entry.code);
    if (child) button.dataset.parentActivityCode = String(entry.code);

    const swatch = el('span', 't-pat');
    swatch.setAttribute('aria-hidden', 'true');
    if (entry.color) swatch.style.background = entry.color;
    else swatch.classList.add('t-pat--general');
    button.append(swatch);

    const body = el('span', 't-activity__body');
    body.append(el('span', 't-activity__title', child ? child.name : entry.name));
    const hint = child ? entry.name : entry.examples;
    if (hint) body.append(el('span', 't-activity__hint', hint));
    button.append(body);

    if (!child && entry.children.length) {
      const end = el('span', 't-activity__end');
      end.setAttribute('aria-hidden', 'true');
      end.textContent = '›';
      button.append(end);
    }

    button.addEventListener('click', () => onChoose(entry, child));
    item.append(button);
    return item;
  }

  /**
   * @param {string} heading
   * @param {import('./activitySearch.js').SearchHit[]} rows
   * @param {'recent' | 'catalogue'} groupKind Marked in the DOM so a shortcut row
   *   above the catalogue is never confused with the catalogue itself.
   */
  function group(heading, rows, groupKind) {
    const section = el('section', 't-activity-group');
    section.dataset.group = groupKind;
    section.append(el('h3', null, heading));
    const list = el('ul', 't-activity-list');
    for (const hit of rows) list.append(row(hit));
    section.append(list);
    fragment.append(section);
  }

  if (!hits.length) {
    const empty = el('p', 't-hint');
    empty.textContent = t('diary.panel.noMatches', { query });
    host.replaceChildren(empty);
    return 0;
  }

  // The shortcut row sits above the catalogue, but only while the participant is
  // not searching: with a query, the matches are the whole answer.
  if (recents.length) {
    group(
      t('diary.panel.recent'),
      recents.map((entry) => ({ entry, child: null, rank: 0, position: 0 })),
      'recent'
    );
  }
  for (const [category, rows] of groupHits(hits)) group(category, rows, 'catalogue');

  host.replaceChildren(fragment);
  return hits.length;
}

/**
 * Hits grouped by their catalogue category, in catalogue order, empty groups
 * dropped. Sub-activity hits group under the category of their parent.
 *
 * @param {import('./activitySearch.js').SearchHit[]} hits
 * @returns {Array<[string, import('./activitySearch.js').SearchHit[]]>}
 */
function groupHits(hits) {
  /** @type {Map<string, import('./activitySearch.js').SearchHit[]>} */
  const groups = new Map();
  for (const hit of hits) {
    const list = groups.get(hit.entry.category) || [];
    list.push(hit);
    groups.set(hit.entry.category, list);
  }
  return [...groups.entries()];
}

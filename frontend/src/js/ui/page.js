// @ts-check
/**
 * The stage page (D40): eyebrow, one `h1`, optional lead, body, actions.
 *
 * Every non-diary page is this page. Before it, each view carried its own
 * heading, padding and alignment, so the study name was the `h1` on two pages,
 * the study's instructions title on a third, a generic sentence on a fourth and
 * nothing at all on the thank-you page - and three of them indented the heading
 * 16 px relative to their own body text.
 *
 * The page owns the heading, so study-supplied Markdown is rendered with
 * `headingOffset: 1`: a `#` in a consent text becomes an `h2`. That keeps one
 * `h1` per page without asking study authors to renumber their texts.
 */
import { el, icon } from './dom.js';
import { renderMarkdown } from '../domain/markdown.js';

/**
 * Study text as body content.
 *
 * @param {string | null | undefined} markdown
 * @returns {HTMLElement}
 */
export function prose(markdown) {
  const node = el('div', 't-prose');
  node.innerHTML = renderMarkdown(markdown, { headingOffset: 1 });
  return node;
}

/**
 * @param {{
 *   eyebrow?: string | null,
 *   title: string,
 *   lead?: string | null,
 *   body?: Array<Node | null | undefined>,
 *   actions?: HTMLElement[],
 *   mark?: string[],
 * }} view
 * @returns {HTMLElement}
 */
export function buildPage(view) {
  const { eyebrow = null, title, lead = null, body = [], actions = [], mark = null } = view;
  const page = el('div', mark ? 't-page t-page--confirm' : 't-page');

  if (mark) {
    const badge = el('div', 't-page__mark');
    badge.append(icon(mark));
    page.append(badge);
  }
  if (eyebrow) page.append(el('p', 't-page__eyebrow', eyebrow));
  page.append(el('h1', 't-page__title', title));
  if (lead) page.append(el('p', 't-page__lead', lead));
  for (const node of body) if (node) page.append(node);

  if (actions.length) {
    const footer = el('div', 't-page__actions');
    footer.append(...actions);
    page.append(footer);
  }
  return page;
}

/**
 * @param {HTMLElement} host
 * @param {Parameters<typeof buildPage>[0]} view
 */
export function renderPage(host, view) {
  host.replaceChildren(buildPage(view));
}

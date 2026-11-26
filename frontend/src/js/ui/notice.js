// @ts-check
/**
 * The one notice box: a bordered block for something that needs attention.
 *
 * It used to be copied into every stage view (and written by hand in the stage
 * machine for the failure state), which is how one page ended up with a notice
 * that had a title and another with only a paragraph. One helper, one look.
 */
import { el } from './dom.js';

/**
 * @param {{
 *   title?: string | null,
 *   text?: string | null,
 *   tone?: 'attention' | 'readonly',
 *   role?: 'alert' | 'status' | null,
 *   extra?: Node[],
 * }} [view]
 * @returns {HTMLElement}
 */
export function notice(view = {}) {
  const { title = null, text = null, tone = 'attention', role = 'alert', extra = [] } = view;
  const box = el('div', `t-notice t-notice--${tone}`);
  if (role) box.setAttribute('role', role);
  const body = el('div', 't-notice__body');
  if (title) body.append(el('p', 't-notice__title', title));
  if (text) body.append(el('p', null, text));
  for (const node of extra) body.append(node);
  box.append(body);
  return box;
}

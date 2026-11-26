// @ts-check
/**
 * The entry page (D37): which study does this visitor want to join?
 *
 * Shown when the URL names no study. The server decides what may appear here -
 * publicly listed, open, currently running studies - so the list never offers a
 * study the diary would refuse.
 *
 * Each entry is one link that carries only the study. The participant id is
 * created when that link is followed (ui/identity.js), which keeps the entry
 * page free of identities: opening it must not invent a participant.
 */
import { el } from '../dom.js';
import { renderPage } from '../page.js';

/**
 * @typedef {{ name_short: string, name?: string | null, description?: string | null }} ListedStudy
 */

/**
 * The link target, relative so the page works under any deployment path.
 *
 * @param {ListedStudy} study
 * @param {string | null} language the interface language to keep
 * @returns {string}
 */
function hrefFor(study, language) {
  const params = new URLSearchParams({ study: study.name_short });
  if (language) params.set('lang', language);
  return `?${params.toString()}`;
}

/**
 * @param {ListedStudy} study
 * @param {string | null} language
 * @returns {HTMLElement}
 */
function studyItem(study, language) {
  const item = el('li', 't-study');
  const link = el('a', 't-study__link');
  link.href = hrefFor(study, language);

  link.append(el('span', 't-study__name', study.name || study.name_short));
  const description = (study.description || '').trim();
  if (description) link.append(el('span', 't-study__description', description));

  item.append(link);
  return item;
}

/**
 * @param {HTMLElement} host the stage host
 * @param {{
 *   studies: ListedStudy[],
 *   language: string | null,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 */
export function renderStudyList(host, { studies, language, t }) {
  const list = el('ul', 't-study-list');
  list.setAttribute('aria-label', t('diary.entry.listLabel'));
  list.append(...studies.map((study) => studyItem(study, language)));

  renderPage(host, {
    title: t('diary.entry.title'),
    lead: t('diary.entry.lead'),
    body: [list],
  });
}

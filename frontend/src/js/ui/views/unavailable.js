// @ts-check
/**
 * The `unavailable` stage (D37, D39): the study is not collecting right now.
 *
 * One page, three different situations, and the server says which one it is in
 * `unavailable_reason`:
 *
 *   - `paused`      the study is paused inside its collection window
 *   - `not_started` the window has not opened yet - say when it does
 *   - `ended`       the window is over - say when it ended, and who to ask
 *
 * Telling a participant who arrived a week early to "contact the research team"
 * is wrong, which is why the reason exists instead of one generic sentence. If
 * the server sends no reason (older payload) or a date cannot be formatted, the
 * generic text is used rather than a sentence with a hole in it.
 */
import { renderPage } from '../page.js';
import { notice } from '../notice.js';
import { formatStudyDate } from '../../domain/dates.js';

/**
 * @param {any} session
 * @param {(key: string, params?: Record<string, string | number>) => string} t
 * @returns {{ title: string, text: string }}
 */
function copyFor(session, t) {
  const language = session.selected_language || session.default_language || 'en';

  if (session.unavailable_reason === 'paused') {
    return {
      title: t('diary.stage.unavailablePausedTitle'),
      text: t('diary.stage.unavailablePausedText'),
    };
  }
  if (session.unavailable_reason === 'not_started') {
    const date = formatStudyDate(session.data_collection_start, language);
    if (date) {
      return {
        title: t('diary.stage.unavailableNotStartedTitle'),
        text: t('diary.stage.unavailableNotStartedText', { date }),
      };
    }
  }
  if (session.unavailable_reason === 'ended') {
    const date = formatStudyDate(session.data_collection_end, language);
    if (date) {
      return {
        title: t('diary.stage.unavailableEndedTitle'),
        text: t('diary.stage.unavailableEndedText', { date }),
      };
    }
  }
  return {
    title: t('diary.stage.unavailableTitle'),
    text: t('diary.stage.unavailableText'),
  };
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   session: any,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 * }} view
 */
export function renderUnavailable(host, { session, t }) {
  const { title, text } = copyFor(session, t);

  renderPage(host, {
    eyebrow: session.study_name,
    title,
    body: [notice({ text, role: 'status' })],
  });
}

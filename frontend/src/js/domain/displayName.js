// @ts-check
/**
 * Whose diary is this? (study config `participant_display_name`)
 *
 * The value is display text only: `pid` stays the identity everywhere, and the
 * name comes from the study's participant roster (`study_participants.display_name`).
 * A study that does not use names sends none, and then nothing is rendered -
 * not an empty "For:" line.
 */

/**
 * @param {any} session the study-config payload
 * @returns {string} the trimmed name, or '' when the study has none
 */
export function participantDisplayName(session) {
  const value = session?.participant_display_name;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The topbar label ("For: Tim"), or '' when there is no name.
 *
 * @param {any} session
 * @param {(key: string, values?: Record<string, string | number>) => string} t
 * @returns {string}
 */
export function forWhomLabel(session, t) {
  const name = participantDisplayName(session);
  return name ? t('diary.shell.forWhom', { name }) : '';
}

/**
 * The document title. A parent filling out two diaries needs to tell the open
 * tabs apart, and that is the one place both are visible at once.
 *
 * @param {any} session
 * @param {(key: string, values?: Record<string, string | number>) => string} t
 * @returns {string}
 */
export function documentTitle(session, t) {
  const name = participantDisplayName(session);
  const appName = t('diary.shell.appName');
  return name ? `${name} · ${appName}` : appName;
}

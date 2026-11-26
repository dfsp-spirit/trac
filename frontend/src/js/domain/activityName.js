// @ts-check
/**
 * The activity name of a custom-input entry.
 *
 * A custom entry ("Bezahlte Arbeit", "Bitte Tätigkeit angeben.") stores what the
 * participant typed as part of the row's name: `Bezahlte Arbeit: Programmieren`.
 * That composed string is the authoritative value - the timeline, the export and
 * the server all use it - so the compose/split pair lives here, in one place,
 * and every reader goes through it. Keeping them apart is how editing an entry
 * used to turn its name into `Bezahlte Arbeit: Bezahlte Arbeit: Programmieren`.
 */

/**
 * @param {string} entryName The catalogue entry, e.g. "Bezahlte Arbeit".
 * @param {string} text What the participant typed, e.g. "Programmieren".
 * @returns {string}
 */
export function composeCustomName(entryName, text) {
  return `${entryName}: ${text}`;
}

/**
 * The typed text of a stored custom activity.
 *
 * A stored name that does not start with the entry's prefix (an older row, or a
 * renamed catalogue entry) is returned unchanged rather than guessed at: showing
 * a whole name in the text field is recoverable, silently cutting it is not.
 *
 * @param {string} entryName The catalogue entry the row belongs to.
 * @param {string | null | undefined} storedName The stored `activity_name`.
 * @returns {string}
 */
export function customActivityText(entryName, storedName) {
  const name = typeof storedName === 'string' ? storedName : '';
  const prefix = `${entryName}: `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

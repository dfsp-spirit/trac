// @ts-check
/**
 * Participant ids for open studies.
 *
 * A closed study hands out an invitation link that already carries a `pid`. An
 * open study is shared as a plain `?study=...` link, so the id is created in the
 * browser on first load - the same thing the classic frontend does. Sixteen
 * digits keep the two frontends interchangeable for the same study.
 */

/**
 * @returns {string} A fresh 16-digit participant id.
 */
export function generateParticipantId() {
  const digits = new Uint8Array(16);
  crypto.getRandomValues(digits);
  return Array.from(digits, (value) => String(value % 10)).join('');
}

// @ts-check
/**
 * Identity comes from the URL and stays in the URL (D37).
 *
 * An invitation link for a closed study names the participant; a shared link
 * for an open study names only the study. In the second case an id is created
 * and written back to the query string, so a reload stays the same participant
 * and the API calls have someone to talk about.
 */
import { generateParticipantId } from '../domain/participantId.js';

/**
 * @param {{ studyName: string | null, participantId: string | null }} identity
 * @returns {string | null} The participant to use, or null when there is no study to join.
 */
export function adoptParticipantId({ studyName, participantId }) {
  if (participantId || !studyName) return participantId;

  const generated = generateParticipantId();
  const url = new URL(window.location.href);
  url.searchParams.set('pid', generated);
  window.history.replaceState(null, '', url);
  return generated;
}

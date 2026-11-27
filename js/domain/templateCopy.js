// @ts-check
/**
 * May the parent be offered "copy the previous child's diary"? (Decision 18)
 *
 * The server enforces the real rules; this decides only whether showing the
 * offer makes sense, so the client never asks for a copy it would refuse:
 * a proxy family with a finished sibling, an empty questionnaire, and a subject
 * the parent has not already answered this question for.
 */

/**
 * @param {{
 *   session: any,
 *   state: any,
 *   handledSubject: string | null,
 * }} input
 * @returns {{ offer: boolean, subjectId: string | null }}
 */
export function shouldOfferTemplateCopy({ session, state, handledSubject }) {
  const proxy = session?.proxy || null;
  const active = proxy?.active || null;
  if (!active || !active.participant_id) return { offer: false, subjectId: null };
  if (state?.status !== 'ready') return { offer: false, subjectId: null };

  const activities = state?.diary?.activities || [];
  if (activities.length > 0) return { offer: false, subjectId: null };

  if ((proxy.finished_count || 0) < 1) return { offer: false, subjectId: null };

  const subjectId = String(active.participant_id);
  if (handledSubject === subjectId) return { offer: false, subjectId };
  return { offer: true, subjectId };
}

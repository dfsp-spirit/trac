// @ts-check
/**
 * Review-then-submit, as one seam (D32, D37).
 *
 * The composition root used to wire the review modal inline: open it with the
 * current diary, submit from inside it, and let the server's answer decide the
 * next stage. That is three responsibilities around one dialog, so they live
 * together here and main.js only says "review".
 */
import { createReviewModal } from './reviewModal.js';

/**
 * @param {{
 *   root: HTMLElement,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   actions: { submit: () => Promise<{ stage: string }> } | null,
 *   stageMachine: { refresh: () => Promise<void> },
 *   getState: () => { diary: any, language: string },
 *   isLocked: () => boolean,
 *   onEdit: (dayIndex: number) => void,
 * }} deps
 */
export function createReviewFlow({ root, t, actions, stageMachine, getState, isLocked, onEdit }) {
  const modal = createReviewModal({
    root,
    t,
    onEdit,
    onSubmit: async () => {
      if (!actions) throw new Error('no participant');
      await actions.submit();
      // Ask the server again instead of applying the stage to the cached
      // payload: the next page is built from fields the submit response does not
      // carry (`external_tasks[].continuation_url` is empty until the diary gate
      // lifts), so reusing the cached session renders a dead "Open" link.
      await stageMachine.refresh();
    },
  });

  function open() {
    const { diary, language } = getState();
    if (isLocked() || !diary) return;
    modal.open(diary, language);
  }

  return { open, destroy: () => modal.destroy() };
}

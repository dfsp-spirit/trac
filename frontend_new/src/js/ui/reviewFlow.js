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
 *   stageMachine: { applyStage: (stage: string) => void },
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
      const result = await actions.submit();
      stageMachine.applyStage(result.stage);
    },
  });

  function open() {
    const { diary, language } = getState();
    if (isLocked() || !diary) return;
    modal.open(diary, language);
  }

  return { open, destroy: () => modal.destroy() };
}

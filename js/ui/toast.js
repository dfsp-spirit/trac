// @ts-check
/**
 * Toast host: one message at a time, optional undo action, always dismissible.
 *
 * Deletes are undone here rather than by a confirmation dialog (D9), so the
 * toast is part of the interaction model, not decoration. It lives in a live
 * region that exists before the message does, so screen readers announce it.
 *
 * The close control is not decoration either: the toast times itself out, and
 * a timed message that sits over the flow (a participant adding entries one
 * after another) needs a way out that does not wait for the timer.
 */

/**
 * @param {HTMLElement} host Element with role="status".
 * @param {{ undo: () => string, dismiss: () => string }} labels
 *
 * Labels are functions, not strings: the toast outlives a language switch, and a
 * string captured at construction would still be the key the translator did not
 * know yet (the panel is built before the locale is loaded).
 */
export function createToast(host, labels) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  function hide() {
    if (timer) clearTimeout(timer);
    timer = null;
    host.replaceChildren();
  }

  /**
   * @param {string} message
   * @param {{ label?: string, run?: () => void | Promise<void> }} [action]
   */
  function show(message, action) {
    hide();
    const toast = document.createElement('div');
    toast.className = 't-toast';

    const text = document.createElement('p');
    text.className = 't-toast__text';
    text.textContent = message;
    toast.append(text);

    if (action?.run) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 't-toast__action';
      button.textContent = action.label || labels.undo();
      button.addEventListener('click', async () => {
        hide();
        await action.run?.();
      });
      toast.append(button);
    }

    // Icon-only so the message keeps its width: a text label wrapped it onto a
    // third line and made the toast 18px taller. The name comes from the
    // translator, so the control is announced in the participant's language.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 't-toast__close';
    close.setAttribute('aria-label', labels.dismiss());
    close.textContent = '×';
    close.addEventListener('click', () => hide());
    toast.append(close);

    host.replaceChildren(toast);
    timer = setTimeout(hide, 6000);
  }

  return { show, hide };
}

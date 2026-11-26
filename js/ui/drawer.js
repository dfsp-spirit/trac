// @ts-check
/**
 * The drawer menu (D28, D40, D41) as a modal <dialog>, not a native `popover`.
 *
 * `popover` reached Firefox only in 125 and Safari in 17, and it does not
 * degrade: an engine that does not know the attribute also does not apply
 * `[popover] { display: none }`, so the drawer would sit on top of the diary for
 * the whole session. A dialog reaches back to Safari 15.4 / Firefox 98 and
 * brings the same top-layer stacking, backdrop, focus trap, focus return and Esc
 * handling; only light dismiss has to be wired here.
 *
 * Below that floor the element is an unknown tag and all that is left is the
 * `open` attribute, which the stylesheet already turns into the same panel.
 */

/**
 * @param {{
 *   element: HTMLDialogElement,
 *   openButton: HTMLElement | null,
 *   closeButton: HTMLElement | null,
 * }} deps
 */
export function createDrawer({ element, openButton, closeButton }) {
  /** @type {HTMLElement | null} */
  let restoreFocusTo = null;

  const supportsModal = typeof element.showModal === 'function';

  /** @returns {boolean} */
  function isOpen() {
    // The attribute, not `.open`: it is the only reading that also works on an
    // engine that does not know the element.
    return element.hasAttribute('open');
  }

  /** @returns {HTMLElement | null} */
  function firstFocusable() {
    return element.querySelector(
      'button, [href], select, input, textarea, [tabindex]:not([tabindex="-1"])'
    );
  }

  function open() {
    if (isOpen()) return;
    const active = document.activeElement;
    restoreFocusTo = active instanceof HTMLElement ? active : null;

    if (supportsModal) element.showModal();
    else {
      element.setAttribute('open', '');
      firstFocusable()?.focus();
    }
  }

  function close() {
    if (!isOpen()) return;
    if (supportsModal) {
      element.close();
      return;
    }
    element.removeAttribute('open');
    restoreFocusTo?.focus();
    restoreFocusTo = null;
  }

  /** @param {MouseEvent} event */
  function onBackdropClick(event) {
    if (event.target !== element) return;
    // Only the backdrop dismisses: the panel's own padding is inside the box and
    // must not close it under the participant's finger.
    const box = element.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) close();
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key !== 'Escape' || !isOpen()) return;
    // A modal dialog would close itself on Esc, but stopping here keeps the
    // diary's own Esc handler from also acting on the same key.
    event.stopPropagation();
    close();
  }

  element.addEventListener('click', onBackdropClick);
  element.addEventListener('keydown', onKeydown);
  openButton?.addEventListener('click', open);
  closeButton?.addEventListener('click', close);

  return {
    open,
    close,
    isOpen,
    destroy() {
      element.removeEventListener('click', onBackdropClick);
      element.removeEventListener('keydown', onKeydown);
      openButton?.removeEventListener('click', open);
      closeButton?.removeEventListener('click', close);
    },
  };
}

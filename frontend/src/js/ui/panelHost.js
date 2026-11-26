// @ts-check
/**
 * Hosting for the activity panel (D29).
 *
 * The same component markup is mounted into the desktop column on wide screens
 * and into a modal dialog on phones. Only one host ever holds content, and the
 * component itself is host-agnostic: it is given an element and never asks which
 * one it got.
 */

/**
 * @param {{
 *   section: HTMLElement | null,
 *   dialog: HTMLDialogElement | null,
 *   template: HTMLTemplateElement | null,
 *   isWide: () => boolean,
 *   translate: (root: HTMLElement) => void,
 * }} deps
 */
export function createPanelHost({ section, dialog, template, isWide, translate }) {
  /**
   * Empty the inactive host and make sure the active one holds a fresh copy of
   * the markup. Returns the host that should be used, or null when the page has
   * no panel slots (which the shell always has).
   *
   * @returns {HTMLElement | null}
   */
  function hostPanel() {
    const wide = isWide();
    const target = wide ? section : dialog;
    const other = wide ? dialog : section;
    if (!target || !other || !template) return null;

    other.replaceChildren();
    if (wide && dialog?.open) dialog.close();

    if (!target.firstElementChild) {
      target.replaceChildren(template.content.cloneNode(true));
      translate(target);
    }

    if (target === dialog) {
      const title = target.querySelector('[data-slot="title"]');
      if (title instanceof HTMLElement) {
        if (!title.id) title.id = `${target.id}-title`;
        target.setAttribute('aria-labelledby', title.id);
      }
    }

    target.querySelector('[data-slot="close"]')?.addEventListener('click', () => {
      if (dialog?.open) dialog.close();
    });

    return target;
  }

  return { hostPanel };
}

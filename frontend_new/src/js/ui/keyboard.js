// @ts-check
/**
 * The keyboard model (D31).
 *
 * The decision - "is this key a shortcut, and which one?" - is a pure function,
 * so it can be tested without a DOM and reviewed in one place. The binding below
 * it only reads the events and calls back.
 *
 * Two rules matter:
 *
 *  * **Single-character shortcuts are confined to the diary region** (timeline or
 *    panel) and never fire while a text field has focus. WCAG 2.1.4 asks for that
 *    of any single-key shortcut, and confinement is cheaper than remapping.
 *  * **Nothing here is reachable on touch.** A phone with a Bluetooth keyboard is
 *    fine, but the feature is aimed at a fine pointer, and the shortcut list is
 *    only offered there.
 */

/** @typedef {'nextDay' | 'prevDay' | 'new' | 'search' | 'escape' | 'help'
 *   | 'moveEarlier' | 'moveLater' | 'endEarlier' | 'endLater'} Shortcut */

/**
 * @typedef {Object} KeyInput
 * @property {string} key `KeyboardEvent.key`
 * @property {boolean} [ctrlKey]
 * @property {boolean} [metaKey]
 * @property {boolean} [altKey]
 * @property {boolean} [shiftKey]
 * @property {boolean} [enabled] The participant has not switched shortcuts off.
 * @property {boolean} [finePointer] `(pointer: fine)` matches.
 * @property {boolean} [inEditable] Focus is in a field that takes typing.
 * @property {boolean} [inScrollable] Focus is in a control that pages its own
 *   content (`<select>`, `<textarea>`, contenteditable).
 * @property {boolean} [inRegion] Focus is inside the timeline or the panel.
 * @property {boolean} [onActivityBlock] Focus is on an activity block in the timeline.
 */
/**
 * @param {KeyInput} input
 * @returns {Shortcut | null}
 */
export function resolveShortcut(input) {
  const {
    key,
    ctrlKey = false,
    metaKey = false,
    altKey = false,
    shiftKey = false,
    enabled = true,
    finePointer = true,
    inEditable = false,
    inScrollable = false,
    inRegion = false,
    onActivityBlock = false,
  } = input;

  if (!enabled || !finePointer) return null;
  // Never steal a browser or OS combination.
  if (ctrlKey || metaKey || altKey) return null;

  // Esc leaves a step, wherever the participant is - including in a field.
  if (key === 'Escape') return 'escape';

  // Paging is not a single-key shortcut, so it works outside the diary region
  // too; only a control that pages its own content keeps it (<select>).
  if (!inScrollable) {
    if (key === 'PageDown') return 'nextDay';
    if (key === 'PageUp') return 'prevDay';
  }

  // Typing is the participant's own business. A scrollable control takes typing
  // too, so it counts even if the caller only reported one of the two flags.
  if (inEditable || inScrollable) return null;
  if (!inRegion) return null;

  // Arrows nudge the focused block only. Anywhere else they must keep scrolling
  // the page, which is why this is not a region-wide shortcut.
  if (onActivityBlock) {
    if (key === 'ArrowUp') return shiftKey ? 'endEarlier' : 'moveEarlier';
    if (key === 'ArrowDown') return shiftKey ? 'endLater' : 'moveLater';
  }

  if (key === 'n' || key === 'N') return 'new';
  if (key === '/') return 'search';
  if (key === '?') return 'help';
  return null;
}

/** Elements that take typing; a shortcut must not fire from inside one. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

/** Elements that page their own content with PageUp/PageDown. */
const SCROLLABLE_SELECTOR = 'textarea, select, [contenteditable="true"]';

/**
 * @param {Element | null} node
 * @param {string} selector
 * @returns {boolean}
 */
function isInside(node, selector) {
  if (!node) return false;
  if (node instanceof HTMLElement && node.isContentEditable) return true;
  return node.closest(selector) != null;
}

/**
 * @param {{
 *   regions: Array<HTMLElement | null>,
 *   isEnabled: () => boolean,
 *   isFinePointer: () => boolean,
 *   isBlocked: () => boolean,
 *   handlers: Partial<Record<Shortcut, () => void>>,
 * }} deps
 * @returns {() => void} Unbind.
 */
export function bindKeyboard({ regions, isEnabled, isFinePointer, isBlocked, handlers }) {
  /** @param {KeyboardEvent} event */
  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    // An open dialog owns Esc, Enter and Tab; the diary behind it is not listening.
    if (isBlocked()) return;

    const target = event.target instanceof Element ? event.target : null;
    const onActivityBlock = target?.closest('.t-event__btn') != null;

    const shortcut = resolveShortcut({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      enabled: isEnabled(),
      finePointer: isFinePointer(),
      inEditable: isInside(target, EDITABLE_SELECTOR),
      inScrollable: isInside(target, SCROLLABLE_SELECTOR),
      inRegion: regions.some((region) => region && region.contains(target)),
      onActivityBlock,
    });
    if (!shortcut) return;

    const handler = handlers[shortcut];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}

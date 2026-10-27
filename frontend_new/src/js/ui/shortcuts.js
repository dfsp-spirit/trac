// @ts-check
/**
 * Keyboard shortcuts, composed (D31): the binding rules from ui/keyboard.js, the
 * list from ui/shortcutsDialog.js, and the menu entry that opens it.
 *
 * Everything this needs from the diary arrives as an action, so the wiring stays
 * in main.js and this module never reads the store.
 */
import { bindKeyboard } from './keyboard.js';
import { createShortcutsDialog } from './shortcutsDialog.js';

/**
 * @param {{
 *   root: HTMLElement,
 *   menu: HTMLElement | null,
 *   menuEntry: HTMLElement | null,
 *   regions: Array<HTMLElement | null>,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   isEnabled: () => boolean,
 *   isFinePointer: () => boolean,
 *   isBlocked: () => boolean,
 *   onToggle: (enabled: boolean) => void,
 *   actions: {
 *     nextDay: () => void,
 *     prevDay: () => void,
 *     newActivity: () => void,
 *     search: () => void,
 *     escape: () => void,
 *   },
 * }} deps
 */
export function createShortcuts({
  root,
  menu,
  menuEntry,
  regions,
  t,
  isEnabled,
  isFinePointer,
  isBlocked,
  onToggle,
  actions,
}) {
  const dialog = createShortcutsDialog({ root, t, isEnabled, onToggle });

  const unbind = bindKeyboard({
    regions,
    isEnabled,
    isFinePointer,
    isBlocked,
    handlers: {
      nextDay: actions.nextDay,
      prevDay: actions.prevDay,
      new: actions.newActivity,
      search: actions.search,
      escape: actions.escape,
      help: () => dialog.open(),
      deleteFocused: () => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement) focused.click();
      },
    },
  });

  /** @param {Event} event */
  const onMenuEntry = (event) => {
    event.preventDefault();
    if (menu && menu.matches(':popover-open')) menu.hidePopover();
    dialog.open();
  };
  menuEntry?.addEventListener('click', onMenuEntry);

  return {
    openList: () => dialog.open(),
    isListOpen: () => dialog.isOpen(),
    destroy() {
      menuEntry?.removeEventListener('click', onMenuEntry);
      unbind();
      dialog.destroy();
    },
  };
}

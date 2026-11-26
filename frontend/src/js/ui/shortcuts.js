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
 *   menuEntry: HTMLElement | null,
 *   closeMenu: () => void,
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
 *     nudge?: (mode: 'move' | 'resize', delta: number) => void,
 *   },
 * }} deps
 */
export function createShortcuts({
  root,
  menuEntry,
  closeMenu,
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
      // One study time step per press; the nudge controller knows the step.
      moveEarlier: () => actions.nudge?.('move', -1),
      moveLater: () => actions.nudge?.('move', 1),
      endEarlier: () => actions.nudge?.('resize', -1),
      endLater: () => actions.nudge?.('resize', 1),
      help: () => dialog.open(),
    },
  });

  /** @param {Event} event */
  const onMenuEntry = (event) => {
    event.preventDefault();
    closeMenu();
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

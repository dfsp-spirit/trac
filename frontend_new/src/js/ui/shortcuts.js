// @ts-check
/**
 * Keyboard shortcuts, composed (D31): the binding rules from ui/keyboard.js, the
 * list from ui/shortcutsDialog.js, and the menu entry that opens it.
 *
 * Everything this needs from the diary arrives as an action, so the wiring stays
 * in main.js and this module never reads the store.
 */
import { STEP_MINUTES } from '../domain/time.js';
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
      moveEarlier: () => actions.nudge?.('move', -STEP_MINUTES),
      moveLater: () => actions.nudge?.('move', STEP_MINUTES),
      endEarlier: () => actions.nudge?.('resize', -STEP_MINUTES),
      endLater: () => actions.nudge?.('resize', STEP_MINUTES),
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

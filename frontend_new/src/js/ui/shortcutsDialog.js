// @ts-check
/**
 * The shortcut list (D31): one menu entry, a compact modal, and the switch that
 * turns the shortcuts off. No separate page, no onboarding step - the menu is the
 * teaching surface, and this dialog is all the explanation there is.
 *
 * It lists what it does rather than documenting the app: one row per action
 * each. Keys are shown as `<kbd>` and are not translated; only the descriptions
 * are, because "PageUp" is the same word in every language.
 */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string | null} [className]
 * @param {string | null} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** @type {Array<{ keys: string[], label: string }>} */
const ROWS = [
  { keys: ['PageUp', 'PageDown'], label: 'diary.shortcuts.days' },
  { keys: ['n'], label: 'diary.shortcuts.new' },
  { keys: ['/'], label: 'diary.shortcuts.search' },
  { keys: ['Esc'], label: 'diary.shortcuts.escape' },
  { keys: ['↑', '↓'], label: 'diary.shortcuts.nudge' },
  { keys: ['Shift + ↑', 'Shift + ↓'], label: 'diary.shortcuts.nudgeEnd' },
  { keys: ['Enter'], label: 'diary.shortcuts.confirm' },
  { keys: ['?'], label: 'diary.shortcuts.list' },
];

/**
 * @param {{
 *   root: HTMLElement,
 *   t: (key: string, params?: Record<string, string | number>) => string,
 *   isEnabled: () => boolean,
 *   onToggle: (enabled: boolean) => void,
 * }} deps
 */
export function createShortcutsDialog({ root, t, isEnabled, onToggle }) {
  const dialog = el('dialog', 't-modal t-modal--centred');
  dialog.id = 'shortcuts-dialog';

  const head = el('div', 't-modal__head');
  const titles = el('div');
  const title = el('h2');
  title.id = 'shortcuts-title';
  titles.append(title);
  head.append(titles);

  const closeButton = el('button', 't-icon-btn');
  closeButton.type = 'button';
  closeButton.setAttribute('data-i18n-aria-label', 'diary.shell.close');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 't-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
  svg.append(path);
  closeButton.append(svg);
  head.append(closeButton);

  const body = el('div', 't-modal__body');
  const facts = el('dl', 't-facts');
  body.append(facts);

  const foot = el('div', 't-modal__foot');
  const toggleLabel = el('label', 't-option');
  const toggle = el('input');
  toggle.type = 'checkbox';
  const toggleText = el('span');
  toggleLabel.append(toggle, toggleText);
  foot.append(toggleLabel);

  dialog.append(head, body, foot);
  dialog.setAttribute('aria-labelledby', title.id);
  root.append(dialog);

  /** @param {boolean} enabled */
  function renderToggle(enabled) {
    toggle.checked = enabled;
  }

  toggle.addEventListener('change', () => onToggle(toggle.checked));
  closeButton.addEventListener('click', () => {
    if (dialog.open) dialog.close();
  });
  dialog.addEventListener('cancel', () => {
    if (dialog.open) dialog.close();
  });

  return {
    open() {
      title.textContent = t('diary.shortcuts.title');
      toggleText.textContent = t('diary.shortcuts.enable');
      facts.replaceChildren();
      for (const row of ROWS) {
        const term = el('dt');
        for (const key of row.keys) {
          if (term.childElementCount) term.append(document.createTextNode(' '));
          term.append(el('kbd', null, key));
        }
        facts.append(term, el('dd', null, t(row.label)));
      }
      renderToggle(isEnabled());
      if (!dialog.open) dialog.showModal();
      toggle.focus();
    },
    close() {
      if (dialog.open) dialog.close();
    },
    isOpen: () => dialog.open,
    destroy() {
      dialog.remove();
    },
  };
}

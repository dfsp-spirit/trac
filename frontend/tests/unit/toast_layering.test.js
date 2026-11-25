// Guards the layering between the transient toast and the activity context menu.
//
// Deleting several entries in a row is a loop of long-press (or right-click) ->
// "Delete". The menu is clamped into the viewport, so near the bottom it lands
// exactly where the receipt from the previous delete floats. Two rules keep that
// receipt harmless, and both are invisible in the other suites because nothing
// there loads the real stylesheet:
//
// * the open menu must paint above the toast, otherwise its last item - the
//   "Delete" a participant aims at - is hidden under it;
// * the toast box must never take the pointer while shown, otherwise a tap meant
//   for "Delete" hits the receipt, and the only part of it that does take clicks
//   is its "Undo" button: the entry that was just deleted comes back.
//
// The third part is behavioural and pinned where it lives: opening the menu calls
// `window.hideToast()` (script.js), so the receipt of the previous action is gone
// before the next one starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = new URL('../../src/', import.meta.url);
const STYLES = readFileSync(new URL('styles/styles.css', SRC), 'utf8');
const SCRIPT = readFileSync(new URL('js/script.js', SRC), 'utf8');

/**
 * The declarations of the first rule whose selector matches exactly.
 *
 * @param {string} css
 * @param {string} selector
 * @returns {string}
 */
function declarations(css, selector) {
  const pattern = new RegExp(
    `(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`,
    'm'
  );
  const match = css.match(pattern);
  assert.ok(match, `styles.css has no rule for ${selector}`);
  return match[2];
}

/**
 * @param {string} declarationsText
 * @param {string} property
 * @returns {string | null}
 */
function value(declarationsText, property) {
  const match = declarationsText.match(
    new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'm')
  );
  return match ? match[1].trim() : null;
}

test('the shown toast never takes the pointer itself', () => {
  // The base rule makes the box transparent to clicks; re-enabling it while
  // shown is what turned a tap on "Delete" into a tap on "Undo".
  assert.equal(value(declarations(STYLES, '.toast'), 'pointer-events'), 'none');

  const shown = declarations(STYLES, '.toast.show');
  assert.ok(
    !value(shown, 'pointer-events') || value(shown, 'pointer-events') === 'none',
    `.toast.show must not re-enable pointer events (found ${value(shown, 'pointer-events')})`
  );

  // ... and its action button still works, which needs `auto` because
  // `pointer-events` is inherited.
  assert.equal(
    value(declarations(STYLES, '.toast-action'), 'pointer-events'),
    'auto'
  );
});

test('the activity context menu paints above the toast', () => {
  const toastZ = Number(value(declarations(STYLES, '.toast'), 'z-index'));
  const menuZ = Number(
    value(declarations(STYLES, '.activity-context-menu'), 'z-index')
  );

  assert.ok(Number.isFinite(toastZ), 'the toast needs a numeric z-index');
  assert.ok(Number.isFinite(menuZ), 'the menu needs a numeric z-index');
  assert.ok(
    menuZ > toastZ,
    `the menu (z-index ${menuZ}) must paint above the toast (z-index ${toastZ})`
  );
});

test('opening the menu drops the previous receipt', () => {
  const start = SCRIPT.indexOf('function showMenu(');
  assert.ok(start !== -1, 'script.js has no showMenu()');

  const end = SCRIPT.indexOf('\n  function ', start + 1);
  const body = SCRIPT.slice(start, end === -1 ? undefined : end);

  const hidden = body.indexOf('window.hideToast()');
  assert.ok(hidden !== -1, 'showMenu() must call window.hideToast()');

  // Before the menu is shown, so the receipt is gone by the time it is visible.
  const shown = body.indexOf("menu.style.display = 'block'");
  assert.ok(shown !== -1, 'showMenu() no longer shows the menu');
  assert.ok(
    hidden < shown,
    'window.hideToast() must run before the menu is shown'
  );
});

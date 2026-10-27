import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShortcut } from '../../src/js/ui/keyboard.js';

/** A keyboard event in the most permissive situation: diary region, fine pointer. */
const base = { inRegion: true, finePointer: true, enabled: true };

test('paging moves between days and works wherever focus is', () => {
  assert.equal(resolveShortcut({ ...base, key: 'PageDown' }), 'nextDay');
  assert.equal(resolveShortcut({ ...base, key: 'PageUp' }), 'prevDay');
  assert.equal(resolveShortcut({ ...base, key: 'PageDown', inRegion: false }), 'nextDay');
});

test('Escape is global, because leaving a state must never need a region', () => {
  assert.equal(resolveShortcut({ ...base, key: 'Escape', inRegion: false }), 'escape');
  assert.equal(
    resolveShortcut({ ...base, key: 'Escape', inEditable: true }),
    'escape',
    'Esc in a field still leaves the step'
  );
});

test('single-character shortcuts only fire inside the diary region', () => {
  assert.equal(resolveShortcut({ ...base, key: 'n' }), 'new');
  assert.equal(resolveShortcut({ ...base, key: '/' }), 'search');
  assert.equal(resolveShortcut({ ...base, key: '?' }), 'help');
  for (const key of ['n', '/', '?']) {
    assert.equal(
      resolveShortcut({ ...base, key, inRegion: false }),
      null,
      `${key} must not fire globally (WCAG 2.1.4)`
    );
  }
});

test('typing in a field is never a shortcut', () => {
  for (const key of ['n', '/', '?', 'Delete']) {
    assert.equal(
      resolveShortcut({ ...base, key, inEditable: true, onDeleteAction: true }),
      null,
      `${key} inside a text field belongs to the field`
    );
  }
});

test('paging still works from a text field, but not from a select', () => {
  assert.equal(
    resolveShortcut({ ...base, key: 'PageDown', inEditable: true }),
    'nextDay',
    'a search field has no use for PageDown'
  );
  assert.equal(
    resolveShortcut({ ...base, key: 'PageDown', inEditable: true, inScrollable: true }),
    null,
    'a select pages its own options'
  );
  assert.equal(resolveShortcut({ ...base, key: 'n', inScrollable: true }), null);
});

test('a modifier means the browser or the OS, not us', () => {
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(resolveShortcut({ ...base, key: 'n', [modifier]: true }), null);
    assert.equal(resolveShortcut({ ...base, key: 'PageDown', [modifier]: true }), null);
  }
});

test('the switch turns every shortcut off, but only on a fine pointer', () => {
  for (const key of ['n', 'PageDown', 'Escape']) {
    assert.equal(resolveShortcut({ ...base, key, enabled: false }), null);
    assert.equal(resolveShortcut({ ...base, key, finePointer: false }), null);
  }
});

test('Delete only acts on the control it is meant to press', () => {
  assert.equal(resolveShortcut({ ...base, key: 'Delete', onDeleteAction: true }), 'deleteFocused');
  assert.equal(resolveShortcut({ ...base, key: 'Backspace', onDeleteAction: true }), 'deleteFocused');
  assert.equal(resolveShortcut({ ...base, key: 'Delete' }), null, 'nothing selected, nothing to delete');
});

test('keys the diary does not use stay untouched', () => {
  for (const key of ['a', 'Enter', 'Tab', 'ArrowDown', ' ', 'F5']) {
    assert.equal(resolveShortcut({ ...base, key }), null, `${key} is not ours`);
  }
});

test('an unknown key in the region is not invented into an action', () => {
  assert.equal(resolveShortcut({ ...base, key: 'Unidentified' }), null);
  assert.equal(resolveShortcut({ key: 'n', inRegion: true }), 'new', 'defaults are permissive');
});

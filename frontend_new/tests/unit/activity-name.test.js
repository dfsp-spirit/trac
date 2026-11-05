import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeCustomName, customActivityText } from '../../src/js/domain/activityName.js';

// A custom-input entry stores what the participant typed as part of the row's
// name ("Bezahlte Arbeit: Programmieren"). Compose and split live together so a
// reader cannot drift from the writer - they did: editing an entry used to put
// the *whole* name back into the text field, and the next save doubled it.

test('the stored name is the entry name and the typed text', () => {
  assert.equal(composeCustomName('Bezahlte Arbeit', 'Programmieren'), 'Bezahlte Arbeit: Programmieren');
});

test('the typed text is recovered from a stored name', () => {
  assert.equal(
    customActivityText('Bezahlte Arbeit', 'Bezahlte Arbeit: Programmieren'),
    'Programmieren'
  );
});

test('text that itself contains a colon survives the round trip', () => {
  const name = composeCustomName('Bezahlte Arbeit', 'Meeting: Planung');
  assert.equal(name, 'Bezahlte Arbeit: Meeting: Planung');
  assert.equal(customActivityText('Bezahlte Arbeit', name), 'Meeting: Planung');
});

test('a name without the prefix is returned unchanged, not guessed at', () => {
  // An older row, or a catalogue entry that was renamed since.
  assert.equal(customActivityText('Bezahlte Arbeit', 'Programmieren'), 'Programmieren');
  assert.equal(customActivityText('Bezahlte Arbeit', 'Alte Arbeit: Programmieren'), 'Alte Arbeit: Programmieren');
  assert.equal(customActivityText('Bezahlte Arbeit', null), '');
  assert.equal(customActivityText('Bezahlte Arbeit', undefined), '');
});

test('editing and saving again keeps exactly one prefix', () => {
  const stored = composeCustomName('Bezahlte Arbeit', 'Programmieren');
  const edited = composeCustomName('Bezahlte Arbeit', customActivityText('Bezahlte Arbeit', stored));
  assert.equal(edited, stored);
});

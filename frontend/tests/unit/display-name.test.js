import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  documentTitle,
  forWhomLabel,
  participantDisplayName,
} from '../../src/js/domain/displayName.js';

// The study config carries the label the diary is filled out for
// (`participant_display_name`). It is display text from the participant roster:
// the id stays the identity, and a study without names renders nothing.

const t = (key, values) => {
  const strings = {
    'diary.shell.forWhom': `For: ${values?.name ?? ''}`,
    'diary.shell.appName': 'Time diary',
  };
  return strings[key] ?? key;
};

test('a name is read from the session and trimmed', () => {
  assert.equal(participantDisplayName({ participant_display_name: ' Tim ' }), 'Tim');
});

test('a missing, blank or non-string name is no name', () => {
  assert.equal(participantDisplayName({}), '');
  assert.equal(participantDisplayName({ participant_display_name: null }), '');
  assert.equal(participantDisplayName({ participant_display_name: '   ' }), '');
  assert.equal(participantDisplayName({ participant_display_name: 42 }), '');
  assert.equal(participantDisplayName(null), '');
});

test('the topbar label names the participant, and is empty without one', () => {
  assert.equal(forWhomLabel({ participant_display_name: 'Tim' }, t), 'For: Tim');
  assert.equal(forWhomLabel({}, t), '');
});

test('the document title tells two diaries apart', () => {
  assert.equal(documentTitle({ participant_display_name: 'Tim' }, t), 'Tim · Time diary');
  assert.equal(documentTitle({}, t), 'Time diary');
});

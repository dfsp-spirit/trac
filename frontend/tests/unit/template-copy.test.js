import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldOfferTemplateCopy } from '../../src/js/domain/templateCopy.js';

function session({ active = 'c2', finished = 1 } = {}) {
  return {
    proxy: {
      active: active ? { participant_id: active, index: 2, total: 2 } : null,
      finished_count: finished,
      total: 2,
    },
  };
}

const empty = { status: 'ready', diary: { activities: [] } };
const filled = { status: 'ready', diary: { activities: [{ id: 1 }] } };

test('offers the copy for an empty questionnaire with a finished sibling', () => {
  const result = shouldOfferTemplateCopy({
    session: session(),
    state: empty,
    handledSubject: null,
  });

  assert.deepEqual(result, { offer: true, subjectId: 'c2' });
});

test('does not offer it a second time for the same child', () => {
  const result = shouldOfferTemplateCopy({
    session: session(),
    state: empty,
    handledSubject: 'c2',
  });

  assert.equal(result.offer, false);
});

test('does not offer it when the first child is still open', () => {
  const result = shouldOfferTemplateCopy({
    session: session({ active: 'c1', finished: 0 }),
    state: empty,
    handledSubject: null,
  });

  assert.equal(result.offer, false);
});

test('never offers it over entries the parent already made', () => {
  const result = shouldOfferTemplateCopy({
    session: session(),
    state: filled,
    handledSubject: null,
  });

  assert.equal(result.offer, false);
});

test('stays silent in a self-report study', () => {
  const result = shouldOfferTemplateCopy({
    session: { participant_display_name: 'Tim' },
    state: empty,
    handledSubject: null,
  });

  assert.deepEqual(result, { offer: false, subjectId: null });
});

test('waits until the diary has loaded', () => {
  const result = shouldOfferTemplateCopy({
    session: session(),
    state: { status: 'loading', diary: null },
    handledSubject: null,
  });

  assert.equal(result.offer, false);
});

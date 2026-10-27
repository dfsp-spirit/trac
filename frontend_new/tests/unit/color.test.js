import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isColour, readableInk } from '../../src/js/domain/color.js';

test('dark and light fills get the opposite ink', () => {
  assert.equal(readableInk('#000000'), '#ffffff');
  assert.equal(readableInk('#ffffff'), '#000000');
  assert.equal(readableInk('#3366cc'), '#ffffff');
  assert.equal(readableInk('#ffe680'), '#000000');
});

test('three-digit hex is accepted and expanded', () => {
  assert.equal(readableInk('#000'), '#ffffff');
  assert.equal(readableInk('#fff'), '#000000');
});

test('an unusable colour falls back to dark ink and is reported as not a colour', () => {
  assert.equal(readableInk(null), '#000000');
  assert.equal(readableInk('not-a-colour'), '#000000');
  assert.equal(isColour('#3366cc'), true);
  assert.equal(isColour('red'), false);
});

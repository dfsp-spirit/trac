// Unit tests for the i18n module: interpolation and key lookup.
import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import i18n from '../../src/js/i18n.js';

// Silence the expected console.warn noise emitted by i18n.t() on missing keys.
const originalWarn = console.warn;
console.warn = () => {};

test('interpolate replaces {{placeholders}} with provided values', () => {
  assert.equal(i18n.interpolate('Hello {{name}}', { name: 'World' }), 'Hello World');
  assert.equal(i18n.interpolate('{{a}}-{{b}}', { a: 1, b: 2 }), '1-2');
});

test('interpolate leaves missing placeholders untouched', () => {
  assert.equal(i18n.interpolate('{{a}}-{{b}}', { a: 1 }), '1-{{b}}');
});

test('interpolate returns text unchanged when there are no placeholders', () => {
  assert.equal(i18n.interpolate('plain text', { x: 1 }), 'plain text');
});

test('t returns the translated string with interpolation', () => {
  i18n.isLoaded = true;
  i18n.translations = { messages: { greet: 'Hi {{name}}' } };
  assert.equal(i18n.t('messages.greet', { name: 'Ada' }), 'Hi Ada');
});

test('t returns the raw key path when the key is missing', () => {
  i18n.isLoaded = true;
  i18n.translations = { messages: { greet: 'Hi' } };
  assert.equal(i18n.t('messages.nope'), 'messages.nope');
});

test('t returns the raw key path when translations are not loaded', () => {
  i18n.isLoaded = false;
  i18n.translations = {};
  assert.equal(i18n.t('buttons.ok'), 'buttons.ok');
});

test('t returns non-string values (e.g. nested objects) unchanged', () => {
  i18n.isLoaded = true;
  i18n.translations = { nested: { map: { a: 1 } } };
  assert.deepEqual(i18n.t('nested.map'), { a: 1 });
});

console.warn = originalWarn;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newUuid } from '../../src/js/domain/uuid.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('newUuid returns a version 4 UUID', () => {
  for (let index = 0; index < 25; index += 1) {
    assert.match(newUuid(), UUID_V4);
  }
});

test('newUuid falls back to getRandomValues when randomUUID is unavailable', () => {
  const proto = Object.getPrototypeOf(globalThis.crypto);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'randomUUID');
  assert.ok(descriptor, 'crypto.randomUUID is expected on the prototype');

  try {
    Object.defineProperty(proto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
    assert.match(newUuid(), UUID_V4);
  } finally {
    Object.defineProperty(proto, 'randomUUID', descriptor);
  }
});

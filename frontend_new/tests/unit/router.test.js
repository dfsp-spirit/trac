import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES,
  formatRoute,
  parseIdentity,
  parseRoute,
  routeForStage,
} from '../../src/js/domain/router.js';

test('every stage maps to a route that exists', () => {
  const stages = ['unavailable', 'consent', 'instructions', 'diary', 'tasks', 'done'];
  for (const stage of stages) {
    assert.ok(ROUTES.includes(routeForStage(stage)), `${stage} -> ${routeForStage(stage)}`);
  }
});

test('an unknown stage falls back to the least revealing page', () => {
  assert.equal(routeForStage('nonsense'), 'unavailable');
  assert.equal(routeForStage(''), 'unavailable');
});

test('both done flavours share one route', () => {
  assert.equal(routeForStage('done'), 'thanks');
});

test('a hash route parses with or without slashes and in any case', () => {
  for (const hash of ['#/consent', '#consent', '#/consent/', '#/CONSENT']) {
    assert.equal(parseRoute(hash), 'consent', hash);
  }
});

test('an unparseable hash resolves to nothing, never to a page', () => {
  for (const hash of ['', '#', '#/', '#/nope', '#/consent/extra', '#/admin']) {
    assert.equal(parseRoute(hash), null, hash);
  }
});

test('routes round-trip through the hash', () => {
  for (const route of ROUTES) {
    assert.equal(parseRoute(formatRoute(route)), route);
  }
});

test('identity comes from the query string and progress never does', () => {
  assert.deepEqual(parseIdentity('?study=adult_pilot_de&pid=bernd&lang=de'), {
    study: 'adult_pilot_de',
    participant: 'bernd',
    language: 'de',
  });
  assert.deepEqual(parseIdentity(''), { study: null, participant: null, language: null });
  assert.deepEqual(
    parseIdentity('?completion_status=noconsent&stage=done'),
    { study: null, participant: null, language: null },
    'old progress flags are ignored, not honoured'
  );
});

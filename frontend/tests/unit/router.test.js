import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES,
  formatRoute,
  parseIdentity,
  parseReturnUrl,
  parseRoute,
  routeForStage,
} from '../../src/js/domain/router.js';
import { createRouter } from '../../src/js/ui/router.js';

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

test('settle corrects a hash that no longer names the stage route', () => {
  let hash = '#/consent';
  const router = createRouter({
    onChange: () => {},
    getHash: () => hash,
    apply: (next) => {
      hash = next;
    },
  });

  assert.equal(router.settle('consent'), 'consent');
  assert.equal(hash, '#/consent');

  hash = '#/diary';
  assert.equal(router.settle('consent'), 'consent');
  assert.equal(hash, '#/consent', 'a hashchange must not outlive the stage guard');
});

test('return_url is read only when it is a usable http(s) destination', () => {
  const base = 'https://trac.example.org';

  assert.equal(
    parseReturnUrl('?return_url=https%3A%2F%2Fpanel.example.org%2Fdone%3Fid%3D7', base),
    'https://panel.example.org/done?id=7'
  );
  assert.equal(
    parseReturnUrl('?return_url=%2Ffinish', base),
    'https://trac.example.org/finish',
    'a relative value resolves against the page, as in the classic client'
  );
  assert.equal(parseReturnUrl('?return_url=javascript%3Aalert(1)', base), null);
  assert.equal(parseReturnUrl('?return_url=', base), null);
  assert.equal(parseReturnUrl('', base), null);
  assert.equal(parseReturnUrl('?study=adult&pid=bernd', base), null);
});

test('the router exposes the return_url so the closing page can offer it', () => {
  const router = createRouter({
    onChange: () => {},
    getHash: () => '#/thanks',
    getSearch: () => '?study=adult&pid=bernd&return_url=https%3A%2F%2Fpanel.example.org%2Fdone',
    origin: () => 'https://trac.example.org',
  });

  assert.equal(router.returnUrl(), 'https://panel.example.org/done');
});

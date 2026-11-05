import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_BUFFERED_EVENTS,
  MAX_EVENTS_PER_BATCH,
  buildBatch,
  createLoadId,
  durationBucket,
  foldQuery,
  normaliseProps,
  shouldCollectSignals,
  viewportClass,
} from '../../src/js/domain/uxEvents.js';
import { createSignals } from '../../src/js/data/signals.js';
import { createFormVisit } from '../../src/js/ui/formVisit.js';

// Usability signals: opt-in per study, unlinked at source. The tests below pin
// the two promises that make the feature acceptable - nothing is sent without
// the study flag *and* consent, and no property can carry personal content.

const SESSION = {
  stage: 'diary',
  save_ux_events: true,
  require_consent: false,
  consent_given: null,
};

const LOAD_ID = '3f2b8c1e-9a4d-4f7b-8c2e-1d5a6b7c8d90';

/** @returns {{ batches: any[], post: (b: any) => void, beacon: (b: any) => void }} */
function fakeSender() {
  const batches = [];
  return {
    batches,
    post: (body) => batches.push(body),
    beacon: (body) => batches.push({ ...body, beacon: true }),
  };
}

/** Signals with every browser dependency stubbed out. */
function signalsWith(sender, overrides = {}) {
  return createSignals({
    send: sender,
    createId: () => LOAD_ID,
    schedule: () => 0,
    cancel: () => {},
    addWindowListener: () => {},
    removeWindowListener: () => {},
    addDocumentListener: () => {},
    removeDocumentListener: () => {},
    viewportWidth: () => 1440,
    now: () => 1_760_000_000_000,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('nothing is collected for a study that did not opt in', () => {
  assert.equal(shouldCollectSignals({ ...SESSION, save_ux_events: false }), false);
  assert.equal(shouldCollectSignals({ ...SESSION, save_ux_events: undefined }), false);
  assert.equal(shouldCollectSignals(null), false);
});

test('a consent-requiring study waits for consent', () => {
  const consenting = { ...SESSION, require_consent: true };
  assert.equal(shouldCollectSignals(consenting), false);
  assert.equal(shouldCollectSignals({ ...consenting, consent_given: false }), false);
  assert.equal(shouldCollectSignals({ ...consenting, consent_given: true }), true);
});

test('a page outside the study flow reports nothing', () => {
  assert.equal(shouldCollectSignals({ ...SESSION, stage: null }), false);
});

test('tracking is inert until a session enables it', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.track('search.no_result', { query: 'kaffee' });
  signals.flush();
  assert.deepEqual(sender.batches, []);
  assert.equal(signals.enabled, false);
});

test('losing consent clears what was already buffered', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  signals.track('search.no_result', { query: 'kaffee' });
  signals.onSession({ ...SESSION, require_consent: true, consent_given: false });
  signals.flush();
  assert.deepEqual(sender.batches, []);
});

// ---------------------------------------------------------------------------
// What may be sent
// ---------------------------------------------------------------------------

test('an unknown event is dropped rather than sent', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  signals.track('participant.favourite_colour', { anything: 'blue' });
  signals.flush();
  const names = sender.batches.flatMap((batch) => batch.events.map((event) => event.name));
  assert.deepEqual(names, ['session.started']);
});

test('properties are filtered to the allow-list, so free text cannot ride along', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  signals.track('activity.form.opened', { source: 'search', note: 'with Anna' });
  signals.flush();
  const opened = sender.batches
    .flatMap((batch) => batch.events)
    .find((event) => event.name === 'activity.form.opened');
  assert.deepEqual(opened.props, { source: 'search' });
});

test('an enumerated property refuses free text', () => {
  assert.deepEqual(normaliseProps('activity.form.opened', { source: 'my words' }), null);
  assert.deepEqual(normaliseProps('activity.form.closed', { outcome: 'saved' }), {
    outcome: 'saved',
  });
});

test('the session.started event carries only the stage and the layout tier', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  signals.onSession({ ...SESSION, stage: 'review' });
  signals.flush();
  const started = sender.batches.flatMap((batch) => batch.events);
  assert.equal(started.length, 1);
  assert.equal(started[0].name, 'session.started');
  assert.deepEqual(started[0].props, { stage: 'diary', viewport_class: 'desktop' });
});

test('a batch never exceeds what the server accepts', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  for (let index = 0; index < MAX_EVENTS_PER_BATCH * 2; index += 1) {
    signals.track('search.no_result', { query: `term${index}` });
  }
  signals.flush();
  assert.ok(sender.batches.length >= 2);
  for (const batch of sender.batches) {
    assert.ok(batch.events.length <= MAX_EVENTS_PER_BATCH);
    assert.equal(batch.load_id, LOAD_ID);
  }
});

test('a long run of events is shipped in full, in bounded batches', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  // Every 10 events triggers an early flush, so the buffer never approaches the
  // hard cap and nothing is dropped on the way.
  for (let index = 0; index < MAX_BUFFERED_EVENTS * 3; index += 1) {
    signals.track('search.no_result', { query: `q${index}` });
  }
  signals.flush();
  const sent = sender.batches.reduce((total, batch) => total + batch.events.length, 0);
  assert.equal(sent, MAX_BUFFERED_EVENTS * 3 + 1, 'all events plus session.started');
  for (const batch of sender.batches) {
    assert.ok(batch.events.length <= MAX_EVENTS_PER_BATCH);
  }
});

test('destroy flushes what is left, by beacon', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  signals.track('search.no_result', { query: 'kaffee' });
  signals.destroy();
  const last = sender.batches.at(-1);
  assert.equal(last.beacon, true);
  assert.ok(last.events.some((event) => event.name === 'search.no_result'));
});

// ---------------------------------------------------------------------------
// Dead-end searches
// ---------------------------------------------------------------------------

test('a dead end is reported once per term, not once per keystroke', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  signals.trackSearch('fruh', 0);
  signals.trackSearch('fruhstuck', 0);
  signals.trackSearch('fruhstuck', 0);
  signals.flush();
  const queries = sender.batches
    .flatMap((batch) => batch.events)
    .filter((event) => event.name === 'search.no_result')
    .map((event) => event.props.query);
  assert.deepEqual(queries, ['fruh', 'fruhstuck']);
});

test('short queries and successful searches are not reported', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  signals.trackSearch('ka', 0);
  signals.trackSearch('kaffee', 2);
  signals.flush();
  const queries = sender.batches
    .flatMap((batch) => batch.events)
    .filter((event) => event.name === 'search.no_result');
  assert.deepEqual(queries, []);
});

test('a successful search lets the same term be reported again later', () => {
  const sender = fakeSender();
  const signals = signalsWith(sender);
  signals.onSession(SESSION);
  signals.trackSearch('kaffee', 0);
  signals.trackSearch('kaffee', 1);
  signals.trackSearch('kaffee', 0);
  signals.flush();
  const queries = sender.batches
    .flatMap((batch) => batch.events)
    .filter((event) => event.name === 'search.no_result').length;
  assert.equal(queries, 2);
});

// ---------------------------------------------------------------------------
// Form visits
// ---------------------------------------------------------------------------

test('a form visit reports how it started and how it ended', () => {
  const events = [];
  let clock = 1000;
  const visit = createFormVisit({ track: (name, props) => events.push({ name, props }), now: () => clock });

  visit.begin({ entry: { children: [] }, editing: false, query: 'kaffee' });
  clock += 45_000;
  visit.end('saved');

  assert.deepEqual(events[0], {
    name: 'activity.form.opened',
    props: { source: 'search', is_custom_input: false },
  });
  assert.deepEqual(events[1].props, {
    outcome: 'saved',
    source: 'search',
    is_custom_input: false,
    duration_bucket: '30to60s',
    had_child_choice: false,
  });
});

test('the entry path is named precisely', () => {
  const sources = [];
  const visit = createFormVisit({
    track: (name, props) => name === 'activity.form.opened' && sources.push(props.source),
  });
  visit.begin({ entry: {}, editing: false });
  visit.end('cancelled');
  visit.begin({ entry: {}, editing: true });
  visit.end('saved');
  visit.begin({ entry: { isCustomInput: true }, editing: false });
  visit.end('deleted');
  visit.begin({ entry: {}, editing: false, groupKind: 'recent' });
  visit.end('cancelled');
  assert.deepEqual(sources, ['catalogue', 'edit', 'custom', 'recent']);
});

test('an open without a close reports nothing - that is the abandonment case', () => {
  const events = [];
  const visit = createFormVisit({ track: (name) => events.push(name) });
  visit.begin({ entry: {}, editing: false });
  // The participant dismisses the panel: no `end()` call follows.
  assert.deepEqual(events, ['activity.form.opened']);
});

test('a visit cannot end twice', () => {
  const events = [];
  const visit = createFormVisit({ track: (name) => events.push(name) });
  visit.begin({ entry: {}, editing: false });
  visit.end('saved');
  visit.end('saved');
  assert.deepEqual(events, ['activity.form.opened', 'activity.form.closed']);
});

// ---------------------------------------------------------------------------
// Folding and buckets
// ---------------------------------------------------------------------------

test('search terms are folded the way the search folds them', () => {
  assert.equal(foldQuery('  FRÜHSTÜCK  mit  Ärger '), 'fruhstuck mit arger');
  assert.equal(foldQuery('Straße'), 'strasse');
  assert.equal(foldQuery('x'.repeat(80)).length, 48);
});

test('layout tiers follow the palette breakpoints', () => {
  assert.equal(viewportClass(320), 'phone');
  assert.equal(viewportClass(900), 'tablet');
  assert.equal(viewportClass(1440), 'desktop');
});

test('duration buckets are coarse on purpose', () => {
  assert.equal(durationBucket(0), 'lt10s');
  assert.equal(durationBucket(9_999), 'lt10s');
  assert.equal(durationBucket(10_000), '10to30s');
  assert.equal(durationBucket(45_000), '30to60s');
  assert.equal(durationBucket(120_000), '1to3m');
  assert.equal(durationBucket(600_000), 'gt3m');
  assert.equal(durationBucket(Number.NaN), 'lt10s');
});

test('a load id is a canonical uuid, so a participant id cannot pass as one', () => {
  assert.match(createLoadId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(
    createLoadId({ randomUUID: () => '3f2b8c1e-9a4d-4f7b-8c2e-1d5a6b7c8d90' }),
    '3f2b8c1e-9a4d-4f7b-8c2e-1d5a6b7c8d90'
  );
});

test('a batch omits empty batch-level fields', () => {
  assert.deepEqual(buildBatch({ loadId: LOAD_ID, events: [], language: null }), {
    load_id: LOAD_ID,
    events: [],
  });
  assert.deepEqual(buildBatch({ loadId: LOAD_ID, events: [], language: 'de', appVersion: '1' }), {
    load_id: LOAD_ID,
    events: [],
    language: 'de',
    app_version: '1',
  });
});

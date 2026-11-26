import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  followStudyLanguage,
  pickInitialLanguage,
  offersLanguageChoice,
  studyLanguageOptions,
} from '../../src/js/domain/language.js';

// Language choice (D40). The bug these rules fix: a German-only study rendered
// English chrome around German text, because the app used its own default
// instead of the URL, the browser or the study.

const SUPPORTED = ['de', 'en', 'sv'];

test('the URL wins when the app can render that language', () => {
  assert.equal(
    pickInitialLanguage({ requested: 'sv', browserLanguages: ['de-DE'], supported: SUPPORTED, fallback: 'en' }),
    'sv'
  );
});

test('an unsupported URL language falls through to the browser', () => {
  assert.equal(
    pickInitialLanguage({ requested: 'fr', browserLanguages: ['de-AT'], supported: SUPPORTED, fallback: 'en' }),
    'de'
  );
});

test('the deployment default is the last resort', () => {
  assert.equal(
    pickInitialLanguage({ requested: null, browserLanguages: ['ja-JP'], supported: SUPPORTED, fallback: 'en' }),
    'en'
  );
  assert.equal(
    pickInitialLanguage({ requested: null, browserLanguages: [], supported: SUPPORTED, fallback: 'sv' }),
    'sv'
  );
});

test('the study language is followed only when the URL did not name one', () => {
  assert.equal(
    followStudyLanguage({ selected: 'de', explicit: null, current: 'en', supported: SUPPORTED }),
    'de'
  );
  assert.equal(
    followStudyLanguage({ selected: 'de', explicit: 'sv', current: 'en', supported: SUPPORTED }),
    null
  );
});

test('following the study never switches to nothing or to an unknown language', () => {
  assert.equal(followStudyLanguage({ selected: null, current: 'en', supported: SUPPORTED }), null);
  assert.equal(followStudyLanguage({ selected: 'en', current: 'en', supported: SUPPORTED }), null);
  assert.equal(followStudyLanguage({ selected: 'fr', current: 'en', supported: SUPPORTED }), null);
});

test('the menu offers the study languages, narrowed to what the app renders', () => {
  assert.deepEqual(studyLanguageOptions(['de'], SUPPORTED), ['de']);
  assert.deepEqual(studyLanguageOptions(['de', 'fr', 'de'], SUPPORTED), ['de']);
  assert.deepEqual(studyLanguageOptions(null, SUPPORTED), SUPPORTED);
  assert.deepEqual(studyLanguageOptions([], SUPPORTED), SUPPORTED);
});

// The menu entry is a choice or it is nothing: a select with one option is
// clutter and invites a reload that cannot change anything (D40).
test('a language switcher is offered only when there is a choice', () => {
  assert.equal(offersLanguageChoice(['de']), false, 'one language is no choice');
  assert.equal(offersLanguageChoice(['de', 'en']), true);
  assert.equal(offersLanguageChoice(['de', 'en', 'sv']), true);
  assert.equal(offersLanguageChoice(['de', 'de']), false, 'duplicates are one language');
  assert.equal(offersLanguageChoice([]), false);
  assert.equal(offersLanguageChoice(null), false);
  assert.equal(offersLanguageChoice(undefined), false);
});

// Guards for page titles and participant-facing naming.
//
// Two failure modes this locks down, both of which have happened:
//
//  1. The diary's <title> was wired to the `common.loading` key. Because
//     i18n.applyTranslations() rewrites the text of every element carrying a
//     data-i18n attribute - <title> included - the tab was stuck on
//     "Loading..." / "Wird geladen ..." no matter how successful the load was,
//     and it came back every time someone re-ordered the init sequence.
//  2. The software brand leaked into participant-facing page names (tab titles,
//     headings), where participants only ever know the study they joined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));
const LOCALES_DIR = join(SRC_DIR, 'locales');

const localeFiles = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort();

const locales = {};
for (const file of localeFiles) {
  locales[file] = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8'));
}

/**
 * Pages whose <title> is i18n-managed: the i18n pass fills it from the key in the
 * markup, and re-applying translations simply writes the same string again.
 */
const I18N_TITLED_PAGES = [
  ['pages/instructions.html', 'instructions.pageTitle'],
  ['pages/open_studies.html', 'openStudies.pageTitle'],
  ['pages/thank-you.html', 'thankYou.title'],
  ['pages/timeout.html', 'timeout.title'],
];

/**
 * Pages whose title names the study, so JS owns it: index.html via
 * applyPageTitle() (js/script.js), consent and tasks via setStudyPageTitle()
 * (js/footer.js). They must NOT carry data-i18n - an i18n pass running later
 * (maintenance.js, the activities modal in ui.js, a language change) rewrites
 * every [data-i18n] element including <title>, which silently replaced the study
 * name with the generic page name.
 */
const JS_TITLED_PAGES = [
  ['index.html', 'common.pageTitle'],
  ['pages/consent.html', 'consent.pageTitle'],
  ['pages/tasks.html', 'taskPage.title'],
];

/**
 * Names a participant has never been told about. `TRAC` is the software,
 * `O-ELIDDI` another product of the same group: neither belongs in participant
 * chrome - the study's own name is the identifier that means something.
 * Developer/operator surfaces (admin portal, dev.html, docs) are out of scope.
 */
const SOFTWARE_BRANDS = ['TRAC', 'O-ELIDDI'];

/** Every page title / heading a participant can read, per locale. */
const PARTICIPANT_FACING_KEYS = [
  'common.pageTitle',
  'consent.pageTitle',
  'instructions.pageTitle',
  'openStudies.pageTitle',
  'openStudies.heading',
  'taskPage.title',
  'thankYou.title',
  'timeout.title',
  'timeout.heading',
];

function getByPath(obj, path) {
  return path.split('.').reduce((o, key) => (o == null ? o : o[key]), obj);
}

test('the diary <title> is not i18n-managed and not a loading message', () => {
  const html = readFileSync(join(SRC_DIR, 'index.html'), 'utf8');
  const titleTag = html.match(/<title[^>]*>[^<]*<\/title>/i);
  assert.ok(titleTag, 'index.html must have a <title> element');

  const [tag] = titleTag;
  const staticText = tag.replace(/<[^>]*>/g, '').trim();

  // i18n must not own this element: applyTranslations() rewrites the text of
  // every [data-i18n] element, <title> included, and it runs again after the
  // diary is built (ui.js activities modal, maintenance.js). With the attribute
  // present the tab is silently reset - first to "Loading..." (while the title
  // was wired to common.loading) and then to the generic app name.
  assert.ok(
    !/data-i18n=/.test(tag),
    `the diary <title> must not carry data-i18n (applyPageTitle in js/script.js owns it): ${tag}`
  );
  assert.ok(
    !/^\s*Loading/i.test(staticText),
    `the diary <title> fallback must not be a loading message, got "${staticText}"`
  );

  // The footer app line is owned by the same helper and must not be reset either.
  const footerSpan = html.match(/<span id="footer_app_title"[^>]*>/);
  assert.ok(footerSpan, 'index.html must have #footer_app_title');
  assert.ok(
    !/data-i18n=/.test(footerSpan[0]),
    `#footer_app_title must not carry data-i18n (applyPageTitle fills it): ${footerSpan[0]}`
  );
});

test('study-named page titles are JS-owned, with a brand-free fallback', () => {
  const en = locales['en.json'];
  for (const [page, key] of JS_TITLED_PAGES) {
    const html = readFileSync(join(SRC_DIR, page), 'utf8');
    const tag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    assert.ok(tag, `${page} must have a <title> element`);
    assert.ok(
      !/data-i18n=/.test(tag[0]),
      `${page} sets its title from the study config, so it must not carry data-i18n: ${tag[0]}`
    );
    assert.equal(
      tag[1].trim(),
      getByPath(en, key),
      `${page} static <title> should equal the English ${key}`
    );
  }
});

test('every participant page title resolves to a localized name', () => {
  for (const [page, key] of I18N_TITLED_PAGES) {
    const html = readFileSync(join(SRC_DIR, page), 'utf8');
    const tag = html.match(/<title[^>]*>[^<]*<\/title>/i);
    assert.ok(tag, `${page} must have a <title> element`);
    assert.equal(
      (tag[0].match(/data-i18n="([^"]+)"/) || [])[1],
      key,
      `${page} should take its title from ${key}`
    );
  }
  for (const [, key] of [...I18N_TITLED_PAGES, ...JS_TITLED_PAGES]) {
    for (const file of localeFiles) {
      const value = getByPath(locales[file], key);
      assert.equal(
        typeof value,
        'string',
        `${file} is missing a string for ${key}`
      );
      assert.ok(
        value.trim() !== '',
        `${file}.${key} is empty, a page would have a blank tab title`
      );
    }
  }
});

test('no software brand in participant-facing titles or headings', () => {
  for (const file of localeFiles) {
    for (const key of PARTICIPANT_FACING_KEYS) {
      const value = getByPath(locales[file], key);
      if (typeof value !== 'string') continue;
      for (const brand of SOFTWARE_BRANDS) {
        assert.ok(
          !value.includes(brand),
          `${file}.${key} shows the software name "${brand}" to participants: ${value}`
        );
      }
    }
  }
});

test('the study title pattern takes the study name and the page name', () => {
  for (const file of localeFiles) {
    const pattern = getByPath(locales[file], 'common.pageTitleWithStudy');
    assert.equal(
      typeof pattern,
      'string',
      `${file} is missing common.pageTitleWithStudy`
    );
    assert.ok(
      pattern.includes('{{study}}') && pattern.includes('{{page}}'),
      `${file}.common.pageTitleWithStudy must interpolate {{study}} and {{page}}, got ${pattern}`
    );
  }
});

test('the static HTML fallbacks match the localized page names', () => {
  // Between HTML parse and the i18n pass the static text is what fills the tab,
  // so it must not be a different (or branded) name.
  const en = locales['en.json'];
  for (const [page, key] of I18N_TITLED_PAGES) {
    const html = readFileSync(join(SRC_DIR, page), 'utf8');
    const tag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    assert.equal(
      tag[1].trim(),
      getByPath(en, key),
      `${page} static <title> should equal the English ${key}`
    );
  }
});

test('the generic page name exists in every locale', () => {
  // Used as the diary's fallback (js/script.js) before the study config lands.
  for (const file of localeFiles) {
    const value = getByPath(locales[file], 'common.pageTitle');
    assert.equal(
      typeof value,
      'string',
      `${file} is missing common.pageTitle (the diary title fallback)`
    );
    assert.ok(
      value.trim() !== '',
      `${file}.common.pageTitle is empty, the diary tab could be blank`
    );
  }
});

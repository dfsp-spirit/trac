import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExternal,
  legalLinks,
  resolveLinkTitle,
} from '../../src/js/ui/legalLinks.js';

// The pages a participant can reach (imprint, data protection, study info,
// contact). The rules worth pinning: no dead entries, the deployment's pair in
// the footer, everything in the menu, and per-study hiding still respected.

/** @param {string} key */
const t = (key) =>
  ({
    'diary.shell.imprint': 'Imprint',
    'diary.shell.dataProtection': 'Data protection',
  })[key] ?? key;

const SESSION = {
  imprint_url: 'https://example.org/imprint',
  privacy_url: 'https://example.org/privacy',
  hide_server_wide_links: false,
  footer_links: [
    { title: { de: 'Studieninformation', en: 'Study information' }, target_url: 'https://example.org/study' },
    { title: { en: 'Contact' }, target_url: 'https://example.org/contact' },
  ],
};

test('the footer holds the deployment legal pages and nothing else', () => {
  const { footer } = legalLinks(SESSION, { language: 'en', t });
  assert.deepEqual(
    footer.map((link) => [link.label, link.href]),
    [
      ['Imprint', 'https://example.org/imprint'],
      ['Data protection', 'https://example.org/privacy'],
    ]
  );
});

test('the menu holds the legal pages plus the study links', () => {
  const { menu } = legalLinks(SESSION, { language: 'en', t });
  assert.deepEqual(
    menu.map((link) => link.label),
    ['Imprint', 'Data protection', 'Study information', 'Contact']
  );
});

test('a study can hide the deployment links; its own links stay', () => {
  const { footer, menu } = legalLinks(
    { ...SESSION, hide_server_wide_links: true },
    { language: 'en', t }
  );
  assert.deepEqual(footer, []);
  assert.deepEqual(
    menu.map((link) => link.label),
    ['Study information', 'Contact']
  );
});

test('links without a URL are dropped instead of rendered dead', () => {
  const { footer, menu } = legalLinks(
    {
      imprint_url: '   ',
      privacy_url: null,
      footer_links: [
        { title: { en: 'No target' }, target_url: '' },
        { title: { en: 'Contact' }, target_url: 'https://example.org/contact' },
        null,
      ],
    },
    { language: 'en', t }
  );
  assert.deepEqual(footer, []);
  assert.deepEqual(
    menu.map((link) => link.label),
    ['Contact']
  );
});

test('a study without any link renders nothing at all', () => {
  for (const session of [null, {}, { footer_links: [] }]) {
    assert.deepEqual(legalLinks(session, { language: 'de', t }), { footer: [], menu: [] });
  }
});

test('study link titles are localized, with English as the fallback', () => {
  assert.equal(resolveLinkTitle({ de: 'Kontakt', en: 'Contact' }, 'de', 'u'), 'Kontakt');
  assert.equal(resolveLinkTitle({ de: 'Kontakt', en: 'Contact' }, 'sv', 'u'), 'Contact');
  // No English either: any language beats an unlabelled entry.
  assert.equal(resolveLinkTitle({ sv: 'Dataskydd' }, 'de', 'u'), 'Dataskydd');
  // Nothing usable: the URL is the last resort, never an empty label.
  assert.equal(resolveLinkTitle({}, 'de', 'https://example.org/x'), 'https://example.org/x');
  assert.equal(resolveLinkTitle('Kontakt', 'de', 'u'), 'Kontakt');
});

test('only targets another site serves count as external', () => {
  assert.equal(isExternal('https://example.org/x'), true);
  assert.equal(isExternal('http://example.org/x'), true);
  assert.equal(isExternal('/report/privacy.html'), false);
  assert.equal(isExternal('privacy.html'), false);
  assert.equal(isExternal('#top'), false);
});

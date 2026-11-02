/**
 * Which language the participant reads, and what follows when they pick another
 * (D34, D35, D40).
 *
 * Every other rewrite fixture is single-language, so `menu.spec.js` can only
 * prove that a choice is *not* offered. `newui_12_language` ships German and
 * English, which makes the positive branch reachable: the app's chrome, the
 * study's own texts and the study's footer links all have to move together.
 *
 * Two participants: `lang_01` never consents, so the page tests can run on every
 * engine; `lang_02` consents once to reach the diary, where the day names are the
 * thing that has to follow.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, studyConfigUrl } from './helpers.js';

const MULTI = 'newui_12_language';
/** Read-only. */
const READ_PID = 'lang_01';
/** Consents once. */
const SPEND_PID = 'lang_02';
/** Single-language control: German-only, which is the D40 case. */
const SINGLE = 'newui_06_diary';
const SINGLE_PID = 'diary_02';

/** @param {import('@playwright/test').Page} page */
async function htmlLang(page) {
  return page.evaluate(() => document.documentElement.lang);
}

/** @param {import('@playwright/test').Page} page */
async function openMenu(page) {
  await page.locator('#menu-open').click();
  await expect(page.locator('#menu')).toBeVisible();
}

test.describe('language', () => {
  test('a single-language study beats an English browser', async ({ page }) => {
    // Playwright's desktop projects report en-US. The study only ships German,
    // so following the browser would put English chrome around German text -
    // exactly what D40 exists to prevent.
    await page.goto(`${BASE_URL}?study=${SINGLE}&pid=${SINGLE_PID}`);
    await expect.poll(() => htmlLang(page)).toBe('de');

    await expect(page.locator('#app-title')).toHaveText('Zeit-Tagebuch');
    await expect(page.locator('#day-label')).toHaveText('Montag');
  });

  test('?lang wins over the study language', async ({ page }) => {
    await page.goto(`${BASE_URL}?study=${MULTI}&pid=${READ_PID}&lang=en`);
    await expect.poll(() => htmlLang(page)).toBe('en');

    await expect(page.locator('.t-page__title')).toHaveText('Before you start');
    await expect(page.locator('.t-prose h2')).toHaveText('Fixture: Consent');
    await expect(page.locator('.t-prose')).toContainText(
      'This is a test text for automated tests, not a real study.'
    );
  });

  test('the menu offers exactly the study languages', async ({ page }) => {
    await page.goto(`${BASE_URL}?study=${MULTI}&pid=${READ_PID}&lang=en`);
    await openMenu(page);

    await expect(page.locator('#menu-language-block')).toBeVisible();
    // The markup carries all three app languages and the disallowed one is
    // hidden rather than removed, so count only what a participant can pick.
    await expect(page.locator('#language-select option:not([hidden])')).toHaveCount(2);
    await expect(page.locator('#language-select option[value="sv"]')).toHaveAttribute(
      'hidden',
      ''
    );
    await expect(page.locator('#language-select')).toHaveValue('en');
  });

  test('picking a language re-fetches the study text and the study links', async ({ page }) => {
    await page.goto(`${BASE_URL}?study=${MULTI}&pid=${READ_PID}&lang=en`);
    await expect.poll(() => htmlLang(page)).toBe('en');
    await openMenu(page);
    await expect(page.locator('#menu-pages')).toContainText('Study information');

    await page.locator('#language-select').selectOption('de');

    await expect.poll(() => htmlLang(page)).toBe('de');
    // The study's own consent text follows, not just the chrome around it.
    await expect(page.locator('.t-page__title')).toHaveText('Bevor Sie beginnen');
    await expect(page.locator('.t-prose h2')).toHaveText('Fixture: Einwilligung');
    // The menu is still open, and its labels and the study's links followed.
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('#menu-language-block label')).toHaveText('Sprache');
    await expect(page.locator('#menu-pages')).toContainText('Studieninformation');
    // No navigation: the URL still asks for English.
    expect(page.url()).toContain('lang=en');
  });

  test('the diary follows too, day names included', async ({ page, request }) => {
    const response = await request.get(studyConfigUrl(SPEND_PID, MULTI, 'en'));
    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    test.skip(
      Boolean(session.consent_given),
      `${MULTI}/${SPEND_PID} has already consented; delete and re-import the study to rerun`
    );

    await page.goto(`${BASE_URL}?study=${MULTI}&pid=${SPEND_PID}&lang=en`);
    await expect.poll(() => htmlLang(page)).toBe('en');
    await page.locator('.t-page__actions .t-btn--primary').click();

    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/diary');
    await expect(page.locator('#day-label')).toHaveText('Monday');

    await openMenu(page);
    await page.locator('#language-select').selectOption('de');

    await expect.poll(() => htmlLang(page)).toBe('de');
    // Day names arrive with the diary, so this only passes if the diary was
    // fetched again rather than re-rendered from the cached payload.
    await expect(page.locator('#day-label')).toHaveText('Montag');
    await expect(page.locator('#app-title')).toHaveText('Zeit-Tagebuch');
  });
});

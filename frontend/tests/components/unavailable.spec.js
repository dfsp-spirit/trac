/**
 * `views/unavailable.js` on a fixture page (D33 rule 8, D39).
 *
 * The e2e spec covers the three reasons the shipped fixtures can express. What
 * it cannot reach are the payloads that are *missing* something - no reason, or
 * a "say when" reason with no date - which are exactly the cases where the view
 * has to fall back instead of rendering a sentence with a hole in it.
 */
import { test, expect } from '@playwright/test';

const GENERIC_TITLE = 'Diese Studie ist derzeit nicht verfügbar';
const GENERIC_TEXT =
  'Sie ist pausiert oder nimmt keine Daten mehr auf. Bitte wenden Sie sich an das Forschungsteam, wenn Sie eine Teilnahme erwartet haben.';

test.describe('unavailable view', () => {
  test('says the study is paused', async ({ page }) => {
    await page.goto('unavailable.html?reason=paused');

    await expect(page.locator('.t-page__title')).toHaveText('Die Studie ist derzeit pausiert');
    await expect(page.locator('.t-notice')).toContainText(
      'Bitte versuchen Sie es später über Ihren Einladungslink erneut.'
    );
    await expect(page.locator('.t-page__eyebrow')).toHaveText('Fixture: Komponentenmontage');
  });

  test('names the day the window opens', async ({ page }) => {
    await page.goto('unavailable.html?reason=not_started');

    await expect(page.locator('.t-page__title')).toHaveText(
      'Die Erhebung hat noch nicht begonnen'
    );
    const text = await page.locator('.t-notice').innerText();
    expect(text.startsWith('Sie beginnt am ')).toBe(true);
    expect(text).toContain('2030');
    // Nothing is left as an unsubstituted placeholder.
    expect(text).not.toContain('{{');
  });

  test('names the day the window ended', async ({ page }) => {
    await page.goto('unavailable.html?reason=ended');

    await expect(page.locator('.t-page__title')).toHaveText('Die Erhebung ist beendet');
    const text = await page.locator('.t-notice').innerText();
    expect(text.startsWith('Der Erhebungszeitraum endete am ')).toBe(true);
    expect(text).toContain('2025');
  });

  test('falls back to the generic sentence without a reason', async ({ page }) => {
    for (const reason of ['', 'unknown']) {
      await page.goto(`unavailable.html?reason=${reason}`);
      await expect(page.locator('.t-page__title')).toHaveText(GENERIC_TITLE);
      await expect(page.locator('.t-notice')).toHaveText(GENERIC_TEXT);
    }
  });

  test('falls back when a dated reason has no date', async ({ page }) => {
    // "Data collection has ended" with no end date would read "ended on ."
    for (const reason of ['ended', 'not_started']) {
      await page.goto(`unavailable.html?reason=${reason}&nodate=1`);
      await expect(page.locator('.t-page__title')).toHaveText(GENERIC_TITLE);
      await expect(page.locator('.t-notice')).toHaveText(GENERIC_TEXT);
    }
  });

  test('is a page frame: one heading, the message as a status', async ({ page }) => {
    await page.goto('unavailable.html?reason=paused');

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.t-notice')).toHaveAttribute('role', 'status');
    await expect(page.locator('.t-page__actions')).toHaveCount(0);
  });
});

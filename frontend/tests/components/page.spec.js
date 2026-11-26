/**
 * `ui/page.js` on a fixture page (D33 rule 8, D40).
 *
 * The frame is what makes "one `h1` per page" and "the study name as eyebrow"
 * true for every stage, and the heading offset is what stops a study's `#` from
 * becoming a second `h1`. All of it is structural, so it is pinned once here
 * instead of three times in the e2e suite.
 */
import { test, expect } from '@playwright/test';

test.describe('page frame', () => {
  test('is an eyebrow, one heading, body and actions', async ({ page }) => {
    await page.goto('page.html?actions=1&lead=1');

    await expect(page.locator('.t-page__eyebrow')).toHaveText('Fixture: Komponentenmontage');
    await expect(page.locator('.t-page__title')).toHaveText('Seitentitel');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveClass(/t-page__title/);
    await expect(page.locator('.t-page__lead')).toHaveText('Ein Satz unter der Überschrift.');
    await expect(page.locator('.t-page__actions button')).toHaveText('Weiter');
  });

  test('demotes study Markdown one level', async ({ page }) => {
    await page.goto('page.html');

    // `#` in a study text becomes `h2`, `##` becomes `h3`: one `h1` per page.
    await expect(page.locator('.t-prose h2')).toHaveText('Studienabschnitt');
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('leaves out what it was not given', async ({ page }) => {
    await page.goto('page.html?eyebrow=0');

    await expect(page.locator('.t-page__eyebrow')).toHaveCount(0);
    await expect(page.locator('.t-page__lead')).toHaveCount(0);
    await expect(page.locator('.t-page__actions')).toHaveCount(0);
    await expect(page.locator('.t-page__mark')).toHaveCount(0);
    // The frame is still a frame.
    await expect(page.locator('.t-page__title')).toHaveText('Seitentitel');
  });

  test('marks a confirmation page and keeps the heading', async ({ page }) => {
    await page.goto('page.html?mark=1');

    await expect(page.locator('.t-page')).toHaveClass(/t-page--confirm/);
    await expect(page.locator('.t-page__mark svg')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

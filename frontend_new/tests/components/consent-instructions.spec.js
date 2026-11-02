/**
 * `views/consent.js` and `views/instructions.js` on fixture pages (D33 rule 8).
 *
 * Both are one decision on top of the page frame, and both have a failure path
 * the e2e suite cannot reach without breaking the API underneath it: the decision
 * rejects, the participant stays on the page, the buttons come back and a notice
 * says so. Without that the page would sit there with two dead buttons.
 */
import { test, expect } from '@playwright/test';

test.describe('consent view', () => {
  test('renders the study text as body, not as headings of its own', async ({ page }) => {
    await page.goto('consent.html');

    await expect(page.locator('.t-page__title')).toHaveText('Bevor Sie beginnen');
    // D40: study Markdown is demoted one level, so `#` becomes `h2`.
    await expect(page.locator('.t-prose h2')).toHaveText('Fixture: Einwilligung');
    await expect(page.locator('.t-prose h3')).toHaveText('Kontakt');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.t-page__actions button')).toHaveCount(2);
  });

  test('reports both answers as a boolean', async ({ page }) => {
    await page.goto('consent.html');

    await page.locator('.t-page__actions .t-btn--primary').click();
    await expect.poll(() => page.evaluate(() => window.__decisions)).toEqual([true]);

    await page.reload();
    await page.locator('.t-page__actions .t-btn--secondary').click();
    await expect.poll(() => page.evaluate(() => window.__decisions)).toEqual([false]);
  });

  test('a rejected decision keeps the participant on the page', async ({ page }) => {
    await page.goto('consent.html?fail=1');

    const agree = page.locator('.t-page__actions .t-btn--primary');
    const decline = page.locator('.t-page__actions .t-btn--secondary');
    await agree.click();

    await expect(page.locator('.t-notice')).toBeVisible();
    await expect(agree).toBeEnabled();
    await expect(decline).toBeEnabled();
    await expect(page.locator('.t-page__title')).toHaveText('Bevor Sie beginnen');
  });
});

test.describe('instructions view', () => {
  test('uses the study title when it has one', async ({ page }) => {
    await page.goto('instructions.html');

    await expect(page.locator('.t-page__title')).toHaveText('Fixture: Anleitung');
    await expect(page.locator('.t-page__actions button')).toHaveCount(1);
  });

  test('falls back to the app heading without a study title', async ({ page }) => {
    await page.goto('instructions.html?title=0');

    await expect(page.locator('.t-page__title')).toHaveText('Anleitung');
  });

  test('confirms once and then stays disabled', async ({ page }) => {
    await page.goto('instructions.html');

    const done = page.locator('.t-page__actions .t-btn--primary');
    await done.click();
    await expect.poll(() => page.evaluate(() => window.__completions)).toBe(1);
    // The server is about to replace this page; re-enabling the button would only
    // offer a second confirmation while the first one is still in flight.
    await expect(done).toBeDisabled();
  });

  test('a rejected confirmation shows a notice and stays', async ({ page }) => {
    await page.goto('instructions.html?fail=1');

    const done = page.locator('.t-page__actions .t-btn--primary');
    await done.click();

    await expect(page.locator('.t-notice')).toBeVisible();
    await expect(done).toBeEnabled();
    expect(await page.evaluate(() => window.__completions)).toBe(1);
  });
});

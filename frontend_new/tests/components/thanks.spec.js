/**
 * `views/thanks.js` on a fixture page (D33 rule 8, D37, D41).
 *
 * Which closing text a participant reads depends on `done_reason`, and the three
 * reasons are only reachable in the e2e suite by closing a study three ways. On
 * a fixture page they are one query parameter, and so are the two fallbacks: a
 * declined participant who has no text of their own, and a skipper whose study
 * never wrote a skipped text.
 */
import { test, expect } from '@playwright/test';

test.describe('thanks view', () => {
  test('a completed diary shows the study closing text', async ({ page }) => {
    await page.goto('thanks.html?reason=completed&skipped=1');

    await expect(page.locator('.t-page__title')).toHaveText('Vielen Dank');
    await expect(page.locator('.t-prose')).toHaveText('Fixture: Das Tagebuch wurde abgegeben.');
  });

  test('declining gets its own heading and text', async ({ page }) => {
    await page.goto('thanks.html?reason=noconsent');

    await expect(page.locator('.t-page__title')).toHaveText('Danke für Ihre Zeit');
    await expect(page.locator('.t-prose')).toHaveText('Fixture: Keine Einwilligung erteilt.');
  });

  test('a skipped diary prefers the skipped text', async ({ page }) => {
    await page.goto('thanks.html?reason=skipped&skipped=1');

    await expect(page.locator('.t-page__title')).toHaveText('Vielen Dank');
    await expect(page.locator('.t-prose')).toHaveText(
      'Fixture: Das Tagebuch wurde übersprungen.'
    );
  });

  test('a skipper without a skipped text falls back to the completed one', async ({ page }) => {
    // Studies that predate the skip option have only `study_text_end_completed`;
    // a skipper of such a study must still not get a blank page.
    await page.goto('thanks.html?reason=skipped&skipped=0');

    await expect(page.locator('.t-prose')).toHaveText('Fixture: Das Tagebuch wurde abgegeben.');
  });

  test('a study with no closing text gets the app sentence', async ({ page }) => {
    await page.goto('thanks.html?reason=completed&text=0');

    await expect(page.locator('.t-prose')).toHaveCount(0);
    await expect(page.locator('.t-page')).toContainText(
      'Ihr Tagebuch wurde an das Forschungsteam gesendet.'
    );
  });

  test('a return_url becomes the one way out', async ({ page }) => {
    await page.goto(
      'thanks.html?reason=completed&return_url=https%3A%2F%2Fpanel.example.org%2Fdone%3Fid%3D7'
    );

    const back = page.locator('.t-page__actions a.t-btn');
    await expect(back).toHaveCount(1);
    await expect(back).toHaveText('Weiter');
    await expect(back).toHaveAttribute('href', 'https://panel.example.org/done?id=7');
  });

  test('a study without a return_url gets no action', async ({ page }) => {
    await page.goto('thanks.html?reason=completed');

    await expect(page.locator('.t-page__actions')).toHaveCount(0);
  });

  test('declining never sends the participant on as finished', async ({ page }) => {
    await page.goto(
      'thanks.html?reason=noconsent&return_url=https%3A%2F%2Fpanel.example.org%2Fdone'
    );

    await expect(page.locator('.t-page__title')).toHaveText('Danke für Ihre Zeit');
    await expect(page.locator('.t-page__actions')).toHaveCount(0);
  });

  test('carries a mark and one heading', async ({ page }) => {
    await page.goto('thanks.html?reason=completed');

    await expect(page.locator('.t-page__mark svg')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
  });
});

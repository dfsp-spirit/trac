/**
 * The review step (D32): day states, *Edit* back to a day, the confirmation
 * step for a complete week, and the refusal for an incomplete one.
 *
 * Uses the prefilled fixture so the day states are known: `ready_01` has all
 * seven days complete, `ready_02` has Monday/Tuesday at ten hours and the rest
 * empty. Nothing is submitted here; the submit-and-lock flow is its own spec.
 */
import { test, expect } from '@playwright/test';
import { isPhone, openDiary } from './helpers.js';

const STUDY = 'newui_08_prefilled';
const REVIEW = '#review-dialog';

test.describe('review modal', () => {
  test('shows open days, edits a day, and refuses an incomplete submit', async ({
    page,
  }) => {
    await openDiary(page, 'ready_02', STUDY);
    await page.locator('#submit-btn').click();

    await expect(page.locator(`${REVIEW}[open]`)).toBeVisible();
    await expect(page.locator(`${REVIEW} .t-review__day`)).toHaveCount(7);
    await expect(page.locator(`${REVIEW} .t-review__day--open`)).toHaveCount(7);

    const monday = page.locator(`${REVIEW} .t-review__day`).nth(0);
    await expect(monday.locator('.t-review__time')).toHaveText('00:00 – 10:00');
    await expect(monday.locator('.t-review__what')).toContainText('Ausruhen');

    // Edit on Wednesday closes the review and makes that day current.
    await page
      .locator(`${REVIEW} .t-review__day`)
      .nth(2)
      .locator('.t-review__edit')
      .click();
    await expect(page.locator(`${REVIEW}[open]`)).toHaveCount(0);
    await expect(page.locator('.t-rail__row[data-day-index="2"]')).toHaveAttribute(
      'aria-current',
      'true'
    );

    let submitted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/diary/submit')) {
        submitted = true;
      }
    });

    await page.locator('#submit-btn').click();
    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();

    await expect(page.locator(`${REVIEW} .t-notice__title`)).toBeVisible();
    await expect(page.locator(`${REVIEW} .t-review__day`)).toHaveCount(7);
    await expect(page.locator(`${REVIEW}[open]`)).toBeVisible();
    await page.waitForTimeout(300);
    expect(submitted).toBe(false);
  });

  test('the progress line and the menu open the same review', async ({ page }, testInfo) => {
    await openDiary(page, 'ready_02', STUDY);

    // Desktop: the progress line is the "am I done?" affordance and opens it too.
    test.skip(isPhone(testInfo), 'the progress line is desktop-only');
    await page.locator('#progress-note').click();
    await expect(page.locator(`${REVIEW}[open]`)).toBeVisible();
    await expect(page.locator('#review-title')).toHaveText('Tagebuch prüfen');
    await page.locator('#review-dialog .t-icon-btn').last().click();
    await expect(page.locator(`${REVIEW}[open]`)).toHaveCount(0);

    await page.locator('#menu-open').click();
    await page.locator('#menu-review').click();
    await expect(page.locator(`${REVIEW}[open]`)).toBeVisible();
  });

  test('two days side by side on desktop, one column on a phone', async ({ page }, testInfo) => {
    await openDiary(page, 'ready_02', STUDY);
    await page.locator('#submit-btn').click();
    await expect(page.locator(`${REVIEW}[open]`)).toBeVisible();

    const columns = await page
      .locator(`${REVIEW} .t-review`)
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    // Consecutive days pair up (day 1 left, day 2 right), so the nth day is where
    // the eye expects it: the same reading order the DOM has.
    expect(columns).toBe(isPhone(testInfo) ? 1 : 2);
  });

  test('a complete week reaches confirmation and can go back', async ({ page }) => {
    await openDiary(page, 'tasks_02', 'newui_09_tasks');
    await page.locator('#submit-btn').click();

    await expect(page.locator(`${REVIEW} .t-review__day`)).toHaveCount(7);
    await expect(page.locator(`${REVIEW} .t-review__day--open`)).toHaveCount(0);

    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();
    await expect(page.locator(`${REVIEW} .t-prose`)).toBeVisible();
    await expect(page.locator(`${REVIEW} .t-modal__foot .t-btn--secondary`)).toBeVisible();

    await page.locator(`${REVIEW} .t-modal__foot .t-btn--secondary`).click();
    await expect(page.locator(`${REVIEW} .t-review__day`)).toHaveCount(7);
    await expect(page.locator(`${REVIEW} .t-modal__foot .t-btn--secondary`)).toHaveCount(0);

    await page
      .locator(`${REVIEW} .t-modal__head button[data-i18n-aria-label="diary.shell.close"]`)
      .click();
    await expect(page.locator(`${REVIEW}[open]`)).toHaveCount(0);
    // The day rail is the desktop summary column; a phone has the day selector
    // in the top bar instead (layout.css), so only assert it where it exists.
    if ((page.viewportSize()?.width ?? 0) >= 1200) {
      await expect(page.locator('.t-rail')).toBeVisible();
    }
  });
});

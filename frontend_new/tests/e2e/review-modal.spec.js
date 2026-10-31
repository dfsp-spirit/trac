/**
 * The review step (D32): day states, *Edit* back to a day, the confirmation
 * step for a complete week, and the refusal for an incomplete one.
 *
 * Uses the prefilled fixture so the day states are known: `ready_01` has all
 * seven days complete, `ready_02` has Monday/Tuesday at ten hours and the rest
 * empty. Nothing is submitted here; the submit-and-lock flow is its own spec.
 */
import { test, expect } from '@playwright/test';
import { openDiary } from './helpers.js';

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

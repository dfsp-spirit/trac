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

    // White while days are open, and the foot says why - the button still works,
    // it explains what is missing instead of vanishing.
    const send = page.locator(`${REVIEW} .t-modal__foot .t-btn`);
    await expect(send).toHaveClass(/t-btn--secondary/);
    await expect(send).not.toHaveClass(/t-btn--primary/);
    await expect(page.locator(`${REVIEW} .t-modal__foot .t-hint`)).toHaveText(
      'Noch nicht alle Tage sind vollständig.'
    );

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
    // The foot's action is secondary while days are open, but it is still the
    // control that answers "can I send it?".
    await page.locator(`${REVIEW} .t-modal__foot .t-btn`).click();

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

  test('a complete week is announced on the diary and turns the top bar black', async ({
    page,
  }) => {
    await openDiary(page, 'tasks_02', 'newui_09_tasks');

    // Two cues, because nothing else on the page changes at that moment: the
    // banner above the timeline, and the top bar button becoming the action.
    const notice = page.locator('#timeline-notices .t-notice');
    await expect(notice.locator('.t-notice__title')).toHaveText('Alle Tage sind vollständig');
    const cta = page.locator('#submit-btn');
    await expect(cta).toHaveClass(/t-btn--primary/);
    await expect(cta).toHaveText('Absenden');
    await expect(cta).toHaveAttribute('data-ready', 'true');

    // Both lead to the same review, where the last step is confirmed.
    await notice.locator('.t-btn--primary').click();
    await expect(page.locator(`${REVIEW}[open]`)).toBeVisible();
    await expect(page.locator(`${REVIEW} .t-modal__foot .t-btn`)).toHaveClass(
      /t-btn--primary/
    );
    await expect(page.locator(`${REVIEW} .t-modal__foot .t-hint`)).toHaveText(
      'Vor dem Absenden bestätigst du im nächsten Schritt.'
    );
  });

  test('an incomplete diary has neither the banner nor a black top bar button', async ({
    page,
  }) => {
    await openDiary(page, 'ready_02', STUDY);

    await expect(page.locator('#timeline-notices .t-notice')).toHaveCount(0);
    const cta = page.locator('#submit-btn');
    await expect(cta).toHaveClass(/t-btn--secondary/);
    await expect(cta).toHaveText('Prüfen');
    await expect(cta).toHaveAttribute('data-ready', 'false');
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

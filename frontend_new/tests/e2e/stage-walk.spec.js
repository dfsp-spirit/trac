/**
 * The whole stage walk: a deep link is corrected, consent leads to instructions,
 * the diary opens, a full week is filled, and submitting reaches the thanks page.
 *
 * Uses the `newui_10_walkthrough` fixture (consent + instructions + diary).
 * `walk_02` only checks the deep-link guard and stays reusable; `walk_01` is
 * submitted and is therefore one-way, like the ready_01 submit fixture.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, chooseActivity, participantsUrl } from './helpers.js';

const STUDY = 'newui_10_walkthrough';
const REVIEW = '#review-dialog';

/** @param {import('@playwright/test').Page} page */
async function currentHash(page) {
  return page.evaluate(() => window.location.hash);
}

test.describe('stage walk', () => {
  test('a deep link cannot skip ahead of the consent stage', async ({ page }) => {
    for (const hash of ['#/thanks', '#/diary']) {
      await page.goto(`${BASE_URL}?study=${STUDY}&pid=walk_02${hash}`);
      await expect.poll(() => currentHash(page)).toBe('#/consent');
      await expect(page.locator('.t-stage .t-page__title')).toBeVisible();
      await expect(page.locator('.t-shell')).toBeHidden();
      await expect(page.locator('#submit-btn')).toBeHidden();
    }
  });

  test('consent, instructions, diary, submit, thanks', async ({ page, request }) => {
    const before = await (
      await request.get(`${participantsUrl(STUDY)}/walk_01/diary`)
    ).json();
    test.skip(
      Boolean(before.study.submitted_at),
      `${STUDY}/walk_01 is already submitted; delete and re-import the study to rerun`
    );

    await page.goto(`${BASE_URL}?study=${STUDY}&pid=walk_01`);
    await expect.poll(() => currentHash(page)).toBe('#/consent');

    await page.locator('.t-page__actions .t-btn--primary').click();
    await expect.poll(() => currentHash(page)).toBe('#/instructions');

    await page.locator('.t-page__actions .t-btn--primary').click();
    await expect.poll(() => currentHash(page)).toBe('#/diary');
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);

    // One full-day entry on every weekday, through the multi-day chips.
    await chooseActivity(page, 1101);
    await page.locator('#form-start').selectOption('0');
    await page.locator('#form-end').selectOption('1440');
    for (let dayIndex = 1; dayIndex < 7; dayIndex += 1) {
      await page.locator(`.t-day-chip input[name="days"][value="${dayIndex}"]`).check();
    }
    await page.locator('[data-slot="actions"] .t-btn--primary').click();
    await expect(page.locator('#days .t-event')).toHaveCount(7);

    await page.locator('#submit-btn').click();
    await expect(page.locator(`${REVIEW}[open]`)).toBeVisible();
    await expect(page.locator(`${REVIEW} .t-review__day--open`)).toHaveCount(0);

    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();
    await expect(page.locator(`${REVIEW} .t-prose`)).toBeVisible();
    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();

    await expect.poll(() => currentHash(page)).toBe('#/thanks');
    await expect(page.locator('.t-stage .t-page__title')).toBeVisible();
    await expect(page.locator('#submit-btn')).toBeHidden();
    await expect(page.locator('#fab')).toBeHidden();

    const after = await (
      await request.get(`${participantsUrl(STUDY)}/walk_01/diary`)
    ).json();
    expect(after.study.submitted_at).toBeTruthy();

    await page.reload();
    await expect.poll(() => currentHash(page)).toBe('#/thanks');
    await expect(page.locator('.t-stage .t-page__title')).toBeVisible();
    await expect(page.locator('#submit-btn')).toBeHidden();
  });
});

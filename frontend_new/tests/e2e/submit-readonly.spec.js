/**
 * Submitting a complete week locks the diary.
 *
 * This is the one one-way fixture: `newui_08_prefilled/ready_01` cannot be
 * un-submitted, so a local rerun skips the test until the study is deleted and
 * re-imported. CI gets a fresh database per run.
 */
import { test, expect } from '@playwright/test';
import { openDiary, participantsUrl } from './helpers.js';

const STUDY = 'newui_08_prefilled';
const PID = 'ready_01';
const REVIEW = '#review-dialog';

test('submits a complete week, locks the diary, and survives reload', async ({
  page,
  request,
}) => {
  const beforeResponse = await request.get(`${participantsUrl(STUDY)}/${PID}/diary`);
  expect(beforeResponse.ok()).toBeTruthy();
  const before = await beforeResponse.json();
  test.skip(
    Boolean(before.study.submitted_at),
    `${STUDY}/${PID} is already submitted; delete and re-import the study to rerun`
  );

  await openDiary(page, PID, STUDY);
  await page.locator('#submit-btn').click();
  await expect(page.locator(`${REVIEW}[open]`)).toBeVisible();
  await expect(page.locator(`${REVIEW} .t-review__day--open`)).toHaveCount(0);

  await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();
  await expect(page.locator(`${REVIEW} .t-prose`)).toBeVisible();
  await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();

  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/thanks');
  await expect(page.locator(`${REVIEW}[open]`)).toHaveCount(0);
  await expect(page.locator('.t-stage .t-page__title')).toBeVisible();
  await expect(page.locator('#submit-btn')).toBeHidden();
  await expect(page.locator('#fab')).toBeHidden();

  const after = await (await request.get(`${participantsUrl(STUDY)}/${PID}/diary`)).json();
  expect(after.study.submitted_at).toBeTruthy();

  await page.reload();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/thanks');
  await expect(page.locator('#submit-btn')).toBeHidden();
  await expect(page.locator('#fab')).toBeHidden();
  await expect(page.locator('.t-stage .t-page__title')).toBeVisible();
});

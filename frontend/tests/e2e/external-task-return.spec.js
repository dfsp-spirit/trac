/**
 * Coming back from an external task (spec §5, D37).
 *
 * The provider returns the browser to the tasks page with the callback
 * parameters in the URL. Redeeming that confirmation is the client's job -
 * nothing else sends it - so a participant whose return was ignored would sit
 * on a task they had already finished, with a "check again" button that could
 * never learn anything.
 *
 * The same visit carries the `return_url` from the invitation link, so this also
 * proves the closing page hands the participant back to the panel provider.
 *
 * One-way: `tasks_04` is submitted and confirmed here, so a second local run
 * skips (delete and re-import the study to rerun).
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, participantsUrl } from './helpers.js';

const STUDY = 'newui_09_tasks';
const PID = 'tasks_04';
const TASK_KEY = 'fixture_survey';
const TOKEN = 'fixture-token-tasks-04';
const RETURN_URL = 'https://panel.example.org/study/finished?member=4711';
const REVIEW = '#review-dialog';

/** @param {import('@playwright/test').Page} page */
async function currentHash(page) {
  return page.evaluate(() => window.location.hash);
}

test.describe('returning from an external task', () => {
  test('callback parameters confirm the task and the closing page hands the participant back', async ({
    page,
    request,
  }) => {
    const diary = await request.get(`${participantsUrl(STUDY)}/${PID}/diary`);
    expect(diary.ok(), 'loading the diary').toBeTruthy();
    const before = await diary.json();
    test.skip(
      Boolean(before.study.submitted_at),
      `${STUDY}/${PID} is already submitted; delete and re-import the study to rerun`
    );

    const invitation = `${BASE_URL}?study=${STUDY}&pid=${PID}` +
      `&return_url=${encodeURIComponent(RETURN_URL)}`;

    // Submit the complete week: two confirmations, nothing to fill in.
    await page.goto(invitation);
    await expect.poll(() => currentHash(page)).toBe('#/diary');
    await page.locator('#submit-btn').click();
    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();
    await expect(page.locator(`${REVIEW} .t-prose`)).toBeVisible();
    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();
    await expect.poll(() => currentHash(page)).toBe('#/tasks');
    await expect(page.locator('.t-task a.t-btn')).toHaveCount(1);

    // The provider sends the browser back with the callback parameters, exactly
    // as the return URL shown in the admin instructs it to.
    await page.goto(
      `${invitation}&callback_task_key=${TASK_KEY}&callback_token=${TOKEN}#/tasks`
    );

    // No click on "check again": the confirmation is redeemed before the stage is
    // read, so the participant is already where the server puts them.
    await expect.poll(() => currentHash(page)).toBe('#/thanks');
    await expect(page.locator('.t-page__title')).toHaveText('Vielen Dank');
    await expect(page.locator('.t-task')).toHaveCount(0);

    // The token is a per-task credential and has just been spent; the identity
    // and the way back stay.
    const settled = new URL(page.url());
    expect(settled.searchParams.get('callback_token')).toBeNull();
    expect(settled.searchParams.get('callback_task_key')).toBeNull();
    expect(settled.searchParams.get('pid')).toBe(PID);
    expect(settled.searchParams.get('return_url')).toBe(RETURN_URL);

    const back = page.locator('.t-page__actions a.t-btn');
    await expect(back).toHaveText('Weiter');
    await expect(back).toHaveAttribute('href', RETURN_URL);

    // Nothing is left owed, so a reload must not put the participant back on the
    // tasks page - the redeemed URL is the same as any other thank-you URL.
    await page.reload();
    await expect.poll(() => currentHash(page)).toBe('#/thanks');
  });
});

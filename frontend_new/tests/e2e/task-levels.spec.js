/**
 * Task levels (D37): level n + 1 opens only once every task of level n is
 * confirmed, and a study that requires the diary opens nothing before it is
 * submitted.
 *
 * This is the payment-task case. Entering bank details is worth money to the
 * participant, so it sits on level 2 behind the survey and behind the diary:
 * the study must not be able to pay for a diary that was never handed in, and a
 * locked task must say so instead of offering a link that cannot work.
 *
 * The server decides both gates and reports `locked_reason` per task; the client
 * renders it. One-way: `levels_01` is submitted and both tasks are confirmed
 * here, so a second local run skips.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, participantsUrl } from './helpers.js';

const STUDY = 'newui_15_task_levels';
const PID = 'levels_01';
const FIRST_TOKEN = 'fixture-token-levels-01';
const SECOND_TOKEN = 'fixture-token-levels-02';
const REVIEW = '#review-dialog';

/** @param {import('@playwright/test').Page} page */
async function currentHash(page) {
  return page.evaluate(() => window.location.hash);
}

test.describe('task levels', () => {
  test('level 2 stays locked until level 1 is confirmed, and both wait for the diary', async ({
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

    await page.goto(`${BASE_URL}?study=${STUDY}&pid=${PID}`);

    // The diary gate comes first: while it is open the participant is in the
    // diary, and no task page exists for them to shortcut.
    await expect.poll(() => currentHash(page)).toBe('#/diary');

    await page.locator('#submit-btn').click();
    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();
    await expect(page.locator(`${REVIEW} .t-prose`)).toBeVisible();
    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();
    await expect.poll(() => currentHash(page)).toBe('#/tasks');

    // Level 1 is open, level 2 is not - and says why.
    const tasks = page.locator('.t-task');
    await expect(tasks).toHaveCount(2);
    await expect(tasks.nth(0).locator('.t-task__name')).toHaveText('Fixture: Erste Aufgabe');
    await expect(tasks.nth(0).locator('a.t-btn')).toHaveCount(1);
    await expect(tasks.nth(1).locator('.t-task__name')).toHaveText('Fixture: Zweite Aufgabe');
    await expect(tasks.nth(1).locator('a.t-btn')).toHaveCount(0);
    await expect(tasks.nth(1).locator('.t-task__locked')).toHaveText(
      'Verfügbar, sobald die vorherigen Aufgaben erledigt sind.'
    );

    // Checking again changes nothing: nobody confirmed the first task.
    await page.getByRole('button', { name: 'Erneut prüfen' }).click();
    await expect(tasks.nth(1).locator('.t-task__locked')).toBeVisible();

    // The provider confirms the first task server-side, as a real one would.
    const first = await request.post(
      `${participantsUrl(STUDY)}/${PID}/external-tasks/confirm`,
      { data: { task_key: 'fixture_first', assigned_token: FIRST_TOKEN } }
    );
    expect(first.ok(), 'confirming the level-1 task').toBeTruthy();

    await page.getByRole('button', { name: 'Erneut prüfen' }).click();
    await expect(tasks.nth(0).locator('.t-task__done')).toHaveCount(1);
    await expect(tasks.nth(1).locator('.t-task__locked')).toHaveCount(0);
    await expect(tasks.nth(1).locator('a.t-btn')).toHaveCount(1);
    await expect(tasks.nth(1).locator('a.t-btn')).toHaveAttribute(
      'href',
      new RegExp(`/external-tasks/fixture_second/launch\\?assigned_token=${SECOND_TOKEN}$`)
    );

    // Only with both confirmed does the participant get their thank-you page.
    const second = await request.post(
      `${participantsUrl(STUDY)}/${PID}/external-tasks/confirm`,
      { data: { task_key: 'fixture_second', assigned_token: SECOND_TOKEN } }
    );
    expect(second.ok(), 'confirming the level-2 task').toBeTruthy();

    await page.getByRole('button', { name: 'Erneut prüfen' }).click();
    await expect.poll(() => currentHash(page)).toBe('#/thanks');
    await expect(page.locator('.t-page__title')).toHaveText('Vielen Dank');
  });
});

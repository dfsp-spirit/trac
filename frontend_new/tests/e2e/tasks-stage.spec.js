/**
 * The `tasks` stage (D37, D41): what the study still wants after the diary.
 *
 * Nothing else covers this page. `review-modal.spec.js` borrows the same fixture
 * to reach a complete week, but it stops at the review dialog, so the list, the
 * launch link, the "check again" button and the refusal-then-success of the
 * diary gate had no browser test at all.
 *
 * The flow is one-way: `tasks_01` is submitted and its task confirmed, so a
 * second local run skips with the reset message (see the plan, 9.5).
 *
 * The link is asserted, never followed - it leads to example.org.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, participantsUrl } from './helpers.js';

const STUDY = 'newui_09_tasks';
const PID = 'tasks_01';
const TASK_KEY = 'fixture_survey';
const TOKEN = 'fixture-token-tasks-01';
const REVIEW = '#review-dialog';

/** @param {import('@playwright/test').Page} page */
async function currentHash(page) {
  return page.evaluate(() => window.location.hash);
}

/** @param {import('@playwright/test').APIRequestContext} request */
async function diaryOf(request) {
  const response = await request.get(`${participantsUrl(STUDY)}/${PID}/diary`);
  expect(response.ok(), 'loading the diary').toBeTruthy();
  return response.json();
}

test.describe('tasks stage', () => {
  test('submitting unlocks the task, and checking again is what moves it', async ({
    page,
    request,
  }) => {
    const before = await diaryOf(request);
    test.skip(
      Boolean(before.study.submitted_at),
      `${STUDY}/${PID} is already submitted; delete and re-import the study to rerun`
    );

    await page.goto(`${BASE_URL}?study=${STUDY}&pid=${PID}`);
    await expect.poll(() => currentHash(page)).toBe('#/diary');
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);

    // Submit the complete week: the review dialog asks once, then confirms.
    await page.locator('#submit-btn').click();
    await expect(page.locator(`${REVIEW} .t-review__day--open`)).toHaveCount(0);
    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();
    await expect(page.locator(`${REVIEW} .t-prose`)).toBeVisible();
    await page.locator(`${REVIEW} .t-modal__foot .t-btn--primary`).click();

    // The diary is over, so the study's remaining task is what is left.
    await expect.poll(() => currentHash(page)).toBe('#/tasks');
    await expect(page.locator('.t-page__title')).toHaveText('Noch ein Schritt');
    await expect(page.locator('.t-page__lead')).toHaveText(
      'Das Forschungsteam braucht dies, um Ihre Teilnahme abzuschließen.'
    );
    await expect(page.locator('.t-stage .t-page__title')).toBeVisible();
    await expect(page.locator('#fab')).toBeHidden();
    await expect(page.locator('#submit-btn')).toBeHidden();

    await expect(page.locator('.t-task')).toHaveCount(1);
    await expect(page.locator('.t-task__name')).toHaveText('Fixture: Umfrage ausfüllen');
    await expect(page.locator('.t-task__hint')).toHaveText(
      'Externe Aufgabe für den Stage-Test "tasks".'
    );
    await expect(page.locator('.t-task__done')).toHaveCount(0);

    // An unlocked task carries a launch URL with this participant's token; while
    // the diary gate held it closed, the payload sent an empty href.
    const open = page.locator('.t-task a.t-btn');
    await expect(open).toHaveAttribute(
      'href',
      new RegExp(`/external-tasks/${TASK_KEY}/launch\\?assigned_token=${TOKEN}$`)
    );

    // The provider has not confirmed anything yet, so checking again changes
    // nothing - the page never guesses that a click on "Open" finished the task.
    const again = page.getByRole('button', { name: 'Erneut prüfen' });
    await again.click();
    await expect(page.locator('.t-task__done')).toHaveCount(0);
    await expect.poll(() => currentHash(page)).toBe('#/tasks');

    // The provider's callback arrives at the API, not through this page.
    const confirmed = await request.post(
      `${participantsUrl(STUDY)}/${PID}/external-tasks/confirm`,
      { data: { task_key: TASK_KEY, assigned_token: TOKEN } }
    );
    expect(confirmed.ok(), 'confirming the callback task').toBeTruthy();

    // Only now does checking again move the participant on.
    await page.getByRole('button', { name: 'Erneut prüfen' }).click();
    await expect.poll(() => currentHash(page)).toBe('#/thanks');
    await expect(page.locator('.t-page__title')).toHaveText('Vielen Dank');
    await expect(page.locator('.t-task')).toHaveCount(0);

    const after = await diaryOf(request);
    expect(after.study.submitted_at).toBeTruthy();
  });
});

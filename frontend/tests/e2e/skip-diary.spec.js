/**
 * Skipping the diary (D41): the entry, the dialog, and what the participant is
 * left with.
 *
 * `menu.spec.js` can only assert that the entry is *hidden* for a study that does
 * not allow it, because no fixture allowed skipping. `newui_11_skip` does, and it
 * also requires a diary before its external task, which is the branch that
 * matters most: the dialog has to say that the remaining task stays locked
 * instead of promising a continuation that will not happen.
 *
 * Two participants, because the reason they exist differs:
 *
 *   - `skip_02` is only ever read, so the dialog can be opened on every engine
 *     even when the whole matrix runs against one database.
 *   - `skip_01` is skipped for good, so the last test guards on that and skips
 *     with the reset message after the first run (see the plan, 9.5).
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, studyConfigUrl } from './helpers.js';

const STUDY = 'newui_11_skip';
/** Read-only: this participant is never skipped. */
const READ_PID = 'skip_02';
/** Written once: the confirmation test closes this diary for good. */
const PID = 'skip_01';
const DIALOG = '#skip-dialog';

/** @param {import('@playwright/test').Page} page */
async function currentHash(page) {
  return page.evaluate(() => window.location.hash);
}

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} pid
 */
async function stageOf(request, pid) {
  const response = await request.get(studyConfigUrl(pid, STUDY));
  expect(response.ok(), 'loading the study config').toBeTruthy();
  return response.json();
}

/**
 * Open the diary and the skip dialog through the menu, which is the only way a
 * participant reaches it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} pid
 */
async function openSkipDialog(page, pid) {
  await page.goto(`${BASE_URL}?study=${STUDY}&pid=${pid}`);
  await expect.poll(() => currentHash(page)).toBe('#/diary');
  await page.locator('#menu-open').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-skip-item')).toBeVisible();
  await page.locator('#menu-skip').click();
  await expect(page.locator(`${DIALOG}[open]`)).toBeVisible();
}

test.describe('skipping the diary', () => {
  test('the entry exists and the dialog states what closes', async ({ page }) => {
    await openSkipDialog(page, READ_PID);

    await expect(page.locator('#skip-title')).toHaveText('Tagebuch überspringen?');
    const body = page.locator(`${DIALOG} .t-modal__body`);
    await expect(body).toContainText('Ihr Tagebuch wird geschlossen');
    await expect(body).toContainText('bleibt erhalten');
    await expect(body).toContainText('Das Forschungsteam sieht');
    // This study needs a diary before its task, so the dialog must not suggest
    // the task can still be done (D41).
    await expect(body).toContainText('Die verbleibenden Aufgaben bleiben gesperrt');
    await expect(body).not.toContainText('weiterhin erledigen');

    // The way out has the focus, not the irreversible button.
    await expect(page.locator(`${DIALOG} .t-btn--secondary`)).toBeFocused();
  });

  test('the note field follows the reason, and cancelling changes nothing', async ({
    page,
    request,
  }) => {
    await openSkipDialog(page, READ_PID);

    const note = page.locator('#skip-note');
    await expect(note).toBeVisible();

    await page.locator('#skip-reason').selectOption('technical_problem');
    await expect(note).toBeHidden();

    await page.locator('#skip-reason').selectOption('other');
    await expect(note).toBeVisible();

    await page.locator(`${DIALOG} .t-btn--secondary`).click();
    await expect(page.locator(`${DIALOG}[open]`)).toHaveCount(0);
    await expect.poll(() => currentHash(page)).toBe('#/diary');

    const after = await stageOf(request, READ_PID);
    expect(after.stage).toBe('diary');
    expect(after.study_skipped_at).toBeNull();
  });

  test('confirming closes the diary and thanks the participant as one who skipped', async ({
    page,
    request,
  }) => {
    const before = await stageOf(request, PID);
    test.skip(
      Boolean(before.study_skipped_at),
      `${STUDY}/${PID} is already skipped; delete and re-import the study to rerun`
    );

    await openSkipDialog(page, PID);
    // "Another reason" is the one choice that accepts a note, so the note is a
    // real submission rather than a field the dialog would have hidden.
    await page.locator('#skip-reason').selectOption('other');
    await expect(page.locator('#skip-note')).toBeVisible();
    await page.locator('#skip-note').fill('Fixture: mein Konto war gesperrt');
    await page.locator(`${DIALOG} .t-btn--primary`).click();

    // Skipped is a `done` with its own reason: the page must not read like a
    // completed diary, and the diary must be gone.
    await expect.poll(() => currentHash(page)).toBe('#/thanks');
    await expect(page.locator('.t-page__title')).toHaveText('Vielen Dank');
    // Scoped to the stage: the closed skip dialog is still in the DOM and has a
    // `.t-prose` of its own.
    await expect(page.locator('.t-stage .t-prose')).toContainText(
      'Fixture: Das Tagebuch wurde übersprungen.'
    );
    await expect(page.locator('.t-stage .t-prose')).not.toContainText('wurde abgegeben');
    await expect(page.locator('#fab')).toBeHidden();
    await expect(page.locator('#submit-btn')).toBeHidden();

    const after = await stageOf(request, PID);
    expect(after.stage).toBe('done');
    expect(after.done_reason).toBe('skipped');
    // Skipping closes the diary the same way submitting does - `study_submitted_at`
    // is the field every lock keys off - and `skipped_at` is what tells the study
    // team that this participant did not fill it.
    expect(after.study_submitted_at).toBeTruthy();
    expect(after.study_skipped_at).toBeTruthy();

    // One-way, and it survives a reload: there is no way back into the diary.
    await page.reload();
    await expect.poll(() => currentHash(page)).toBe('#/thanks');
    await page.locator('#menu-open').click();
    await expect(page.locator('#menu-skip-item')).toBeHidden();
  });
});

/**
 * The accessibility gate: WCAG 2.0 / 2.1 / 2.2 level A + AA on every surface a
 * participant can be looking at.
 *
 * One test per surface, in one file, so the list below *is* the coverage
 * argument. The scans run on the two layout legs only - `chromium` (three columns,
 * panel as a column) and `mobile-chrome` (393px, panel as a modal) - because axe's
 * rules are DOM/ARIA-based and engine-independent in practice, and five legs
 * would cost five times as much for no additional finding.
 *
 * Two surfaces are only reachable by writing: `tasks` and the `thanks` page it
 * leads to. `newui_09_tasks/tasks_03` exists for exactly that - one participant,
 * spent once, so the other specs keep theirs.
 */
import { test, expect } from '@playwright/test';
import { expectNoA11yViolations } from './a11y.js';
import {
  BASE_URL,
  addActivity,
  chooseActivity,
  clearActivities,
  openDiary,
  openPanel,
  participantsUrl,
} from './helpers.js';

const LEGS = new Set(['chromium', 'mobile-chrome']);
/** The participant the writing scans use, and only they. */
const SPEND_STUDY = 'newui_09_tasks';
const SPEND_PID = 'tasks_03';
/** The diary participant every read-only scan uses. */
const DIARY_PID = 'diary_02';

test.beforeEach(async ({ page, request }, testInfo) => {
  test.skip(
    !LEGS.has(testInfo.project.name),
    'axe runs on the desktop and phone layout legs; the rules do not vary by engine'
  );
  // Several scans add an activity so the rail and panel are not empty; starting
  // from a known diary keeps the contrast and landmark results stable.
  await clearActivities(request, DIARY_PID);
});

test.afterEach(async ({ request }) => {
  await clearActivities(request, DIARY_PID);
});

test.describe('accessibility', () => {
  test('the unavailable page', async ({ page }) => {
    await page.goto(`${BASE_URL}?study=newui_02_paused&pid=paused_01&lang=de`);
    await expect(page.locator('.t-page__title')).toBeVisible();
    await expectNoA11yViolations(page, 'unavailable');
  });

  test('the consent page', async ({ page }) => {
    await page.goto(`${BASE_URL}?study=newui_07_consent&pid=consent_02&lang=de`);
    await expect(page.locator('.t-page__title')).toBeVisible();
    await expectNoA11yViolations(page, 'consent');
  });

  test('the instructions page', async ({ page }) => {
    await page.goto(`${BASE_URL}?study=newui_05_instructions&pid=instructions_01&lang=de`);
    await expect(page.locator('.t-page__title')).toBeVisible();
    await expectNoA11yViolations(page, 'instructions');
  });

  test('the entry page', async ({ page }) => {
    // No invitation in the URL: the page a visitor lands on, and the only one
    // with no session behind it. It lists the publicly listed studies.
    await page.goto(`${BASE_URL}?lang=de`);
    await expect(page.locator('.t-page__title')).toBeVisible();
    await expectNoA11yViolations(page, 'entry page');
  });

  test('the diary, with a filled day', async ({ page }) => {
    await openDiary(page, DIARY_PID);
    await addActivity(page, 1101, { start: 480, end: 540 });
    await expect(page.locator('#days .t-event')).toHaveCount(1);
    await expectNoA11yViolations(page, 'diary');
  });

  test('the diary when every day is complete', async ({ page }) => {
    // The "ready to send" banner and the black top bar action - the only cue on a
    // phone, where the progress line does not exist.
    await openDiary(page, 'tasks_02', 'newui_09_tasks');
    await expect(page.locator('#timeline-notices .t-notice')).toBeVisible();
    await expectNoA11yViolations(page, 'diary ready to submit');
  });

  test('the activity panel, on its form step', async ({ page }) => {
    await openDiary(page, DIARY_PID);
    await openPanel(page);
    await chooseActivity(page, 1101);
    await expect(page.locator('#form-start')).toBeVisible();
    await expectNoA11yViolations(page, 'activity form');
  });

  test('the drawer menu', async ({ page }) => {
    await openDiary(page, DIARY_PID);
    await page.locator('#menu-open').click();
    await expect(page.locator('#menu')).toBeVisible();
    await expectNoA11yViolations(page, 'menu drawer');
  });

  test('the keyboard shortcut list', async ({ page }) => {
    await openDiary(page, DIARY_PID);
    await page.locator('#menu-open').click();
    await page.locator('#menu-shortcuts').click();
    await expect(page.locator('#shortcuts-dialog')).toHaveAttribute('open', '');
    await expectNoA11yViolations(page, 'shortcut list');
  });

  test('the review dialog', async ({ page }) => {
    // `newui_08_prefilled/ready_02` has open days, which is the state most
    // participants see - and unlike `ready_01` it is never submitted by another
    // spec, so this scan does not depend on which leg runs first.
    await openDiary(page, 'ready_02', 'newui_08_prefilled');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#review-dialog')).toHaveAttribute('open', '');
    await expectNoA11yViolations(page, 'review dialog');
  });

  test('the copy-day dialog', async ({ page }) => {
    // `ready_02` again: days with entries, so the source receipt and the marked
    // target chips are both on screen. Opened from a day heading, which exists on
    // both legs (the rail does not).
    await openDiary(page, 'ready_02', 'newui_08_prefilled');
    await page.locator('#days .t-timeline-day[data-day-index="0"] [data-copy-day]').click();
    await expect(page.locator('#copy-day-dialog')).toHaveAttribute('open', '');
    await expectNoA11yViolations(page, 'copy dialog');
  });

  test('the skip dialog', async ({ page }) => {
    // `skip_02` is the read-only half of that fixture: the dialog is scanned and
    // cancelled, so the participant stays usable.
    await openDiary(page, 'skip_02', 'newui_11_skip');
    await page.locator('#menu-open').click();
    await page.locator('#menu-skip').click();
    await expect(page.locator('#skip-dialog')).toHaveAttribute('open', '');
    await expectNoA11yViolations(page, 'skip dialog');
  });

  test('the tasks page and the thanks page it leads to', async ({ page, request }) => {
    const diaryUrl = `${participantsUrl(SPEND_STUDY)}/${SPEND_PID}/diary`;
    const before = await (await request.get(diaryUrl)).json();
    test.skip(
      Boolean(before.study.submitted_at),
      `${SPEND_STUDY}/${SPEND_PID} is already submitted; delete and re-import the study to rerun`
    );

    await page.goto(`${BASE_URL}?study=${SPEND_STUDY}&pid=${SPEND_PID}&lang=de`);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/diary');

    // The week is prefilled, so submitting is two confirmations.
    await page.locator('#submit-btn').click();
    await page.locator('#review-dialog .t-modal__foot .t-btn--primary').click();
    await expect(page.locator('#review-dialog .t-prose')).toBeVisible();
    await page.locator('#review-dialog .t-modal__foot .t-btn--primary').click();

    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/tasks');
    await expect(page.locator('.t-page__title')).toBeVisible();
    await expectNoA11yViolations(page, 'tasks');

    // The provider confirms out of band, and "check again" is what moves the
    // participant on - the same path a real one takes.
    const confirmed = await request.post(
      `${participantsUrl(SPEND_STUDY)}/${SPEND_PID}/external-tasks/confirm`,
      { data: { task_key: 'fixture_survey', assigned_token: 'fixture-token-tasks-03' } }
    );
    expect(confirmed.ok(), 'confirming the callback task').toBeTruthy();
    await page.getByRole('button', { name: 'Erneut prüfen' }).click();

    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/thanks');
    await expect(page.locator('.t-page__title')).toBeVisible();
    await expectNoA11yViolations(page, 'thanks');
  });
});

/**
 * The diary's basic lifecycle: create an activity, edit it, delete it, undo the
 * delete.
 *
 * Uses the `newui_06_diary` fixture, which lands directly in the diary (no
 * consent, no instructions). Activities are cleared through the public diary API
 * before and after each test, so repeated local runs start from the same state
 * and the test does not depend on a fresh database.
 */
import { test, expect } from '@playwright/test';
import {
  addSchlafen,
  chooseActivity,
  clearActivities,
  isPhone,
  openDiary,
  setTime,
} from './helpers.js';

test.describe('activity lifecycle', () => {
  const pid = 'diary_01';

  test.beforeEach(async ({ request }) => clearActivities(request, pid));
  test.afterEach(async ({ request }) => clearActivities(request, pid));

  test('create, edit, reload and delete with undo', async ({ page }) => {
    await openDiary(page, pid);

    await addSchlafen(page, { start: 480, end: 540 });
    await expect(page.locator('.t-event')).toHaveCount(1);
    await expect(page.locator('.t-event__title')).toHaveText('Schlafen');
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*09:00/);

    await page.reload();
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
    await expect(page.locator('.t-event')).toHaveCount(1);
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*09:00/);

    await page.locator('.t-event__btn').first().click();
    await setTime(page, '#form-end', 600);
    await page.locator('[data-slot="actions"] .t-btn--primary').click();
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*10:00/);

    await page.reload();
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*10:00/);

    await page.locator('.t-event__btn').first().click();
    await page.locator('[data-slot="actions"] .t-btn--ghost').click();
    await expect(page.locator('.t-event')).toHaveCount(0);
    await expect(page.locator('.t-toast__action')).toBeVisible();

    // Deleting returns to the diary. On a phone the panel is a modal dialog in
    // the top layer, and it would otherwise cover the Undo toast.
    await expect(page.locator('#dialog-host')).toBeHidden();
    await page.locator('.t-toast__action').click();
    await expect(page.locator('.t-event')).toHaveCount(1);
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*10:00/);
  });

  test('the save toast does not swallow the next save', async ({ page }) => {
    await openDiary(page, pid);
    await addSchlafen(page, { start: 480, end: 540 });
    await expect(page.locator('.t-toast')).toBeVisible();

    // Saving again while the toast is still up. Above 1200px the toast floats
    // over the panel's footer, so this click used to land on the toast text
    // instead - or on its Undo button, deleting the entry just saved. The short
    // timeout is the assertion: the click has to be accepted now, not when the
    // toast times out six seconds later.
    await chooseActivity(page, 1102);
    await setTime(page, '#form-start', 600);
    await setTime(page, '#form-end', 660);
    await page.locator('[data-slot="actions"] .t-btn--primary').click({ timeout: 3000 });

    await expect(page.locator('.t-event')).toHaveCount(2);
    await expect(page.locator('.t-toast')).toContainText('Ausruhen');
  });

  // Below 1200px the panel is a modal dialog in the top layer: leaving it open
  // after a save hides the diary and makes the Undo toast untappable. Returning
  // to the timeline is also what the participant expects - except when they ask
  // for the next entry, which keeps the panel open on the catalogue.
  //
  // Above 1200px the panel is a column that never closes, so "add another" has
  // no job: the timeline and its gaps stay in view, and both save buttons landed
  // on the catalogue anyway. It is hidden there (panel.css, D29).
  test('a save closes the phone panel, "add another" keeps it open', async ({
    page,
  }, testInfo) => {
    await openDiary(page, pid);
    await chooseActivity(page, 1101);
    await setTime(page, '#form-start', 480);
    await setTime(page, '#form-end', 540);

    const actions = page.locator('[data-slot="actions"]');
    const another = actions.locator('[data-slot="save-another"]');

    if (isPhone(testInfo)) {
      // "Add another" saves and goes back to the catalogue with the next range
      // prefilled, so the panel has a reason to stay open.
      await another.click();
      await expect(page.locator('.t-activity').first()).toBeVisible();
      await expect(page.locator('#dialog-host')).toHaveAttribute('open', '');
    } else {
      // Create mode on desktop has one action: the same markup as the phone
      // (the panel is host-agnostic), hidden by panel.css. Delete only appears
      // when editing.
      await expect(another).toHaveCount(1);
      await expect(another).toBeHidden();
      await expect(actions.locator('button:visible')).toHaveCount(1);
      await actions.locator('.t-btn--primary').click();
      await expect(page.locator('.t-activity').first()).toBeVisible();
    }

    // Picking again starts from that prefill; saving this one returns to the
    // diary, and on a phone it closes the panel.
    await chooseActivity(page, 1101);
    await setTime(page, '#form-start', 600);
    await setTime(page, '#form-end', 650);
    await page.locator('[data-slot="actions"] .t-btn--primary').click();
    await expect(page.locator('#dialog-host')).toBeHidden();
    await expect(page.locator('.t-event')).toHaveCount(2);
  });
});

test.describe('saving from a non-secure origin', () => {
  const pid = 'diary_02';

  test.beforeEach(async ({ request }) => clearActivities(request, pid));
  test.afterEach(async ({ request }) => clearActivities(request, pid));

  test('writes without crypto.randomUUID, as on a plain-http LAN address', async ({
    page,
  }) => {
    // Phones reach the dev stack via http://192.168.x.x:3000, which is not a
    // secure context: crypto.randomUUID is absent there even though
    // crypto.getRandomValues exists. Pin that case so a save cannot regress to
    // "Nicht gespeichert" without ever sending a request.
    await page.addInitScript(() => {
      const proto = Object.getPrototypeOf(window.crypto);
      Object.defineProperty(proto, 'randomUUID', {
        value: undefined,
        configurable: true,
      });
    });

    await openDiary(page, pid);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');

    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/activities')
    );

    await addSchlafen(page, { start: 600, end: 660 });

    expect((await saved).status()).toBe(201);
    await expect(page.locator('.t-event')).toHaveCount(1);
    await expect(page.locator('.t-form .t-notice')).toHaveCount(0);

    // Undo also creates a row (with a fresh client id), so it must survive the
    // same missing-randomUUID condition. Saving closed the panel on a phone, so
    // the timeline is reachable again.
    await expect(page.locator('#dialog-host')).toBeHidden();
    await page.locator('.t-event__btn').first().click();
    await page.locator('[data-slot="actions"] .t-btn--ghost').click();
    await expect(page.locator('.t-event')).toHaveCount(0);
    await expect(page.locator('#dialog-host')).toBeHidden();
    await page.locator('.t-toast__action').click();
    await expect(page.locator('.t-event')).toHaveCount(1);
    await expect(page.locator('.t-event__time')).toHaveText(/10:00\s*–\s*11:00/);
  });
});

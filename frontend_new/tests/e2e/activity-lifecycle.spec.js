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
import { addSchlafen, clearActivities, openDiary } from './helpers.js';

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
    await page.locator('#form-end').selectOption('600');
    await page.locator('[data-slot="actions"] .t-btn--primary').click();
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*10:00/);

    await page.reload();
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*10:00/);

    await page.locator('.t-event__btn').first().click();
    await page.locator('[data-slot="actions"] .t-btn--ghost').click();
    await expect(page.locator('.t-event')).toHaveCount(0);
    await expect(page.locator('.t-toast__action')).toBeVisible();

    await page.locator('.t-toast__action').click();
    await expect(page.locator('.t-event')).toHaveCount(1);
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*10:00/);
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
    // same missing-randomUUID condition.
    await page.locator('.t-event__btn').first().click();
    await page.locator('[data-slot="actions"] .t-btn--ghost').click();
    await expect(page.locator('.t-event')).toHaveCount(0);
    await page.locator('.t-toast__action').click();
    await expect(page.locator('.t-event')).toHaveCount(1);
    await expect(page.locator('.t-event__time')).toHaveText(/10:00\s*–\s*11:00/);
  });
});

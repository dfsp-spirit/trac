/**
 * The line under "Also on other days?" and the toast that follows it: the form
 * says up front which ticked days will really take the entry, and the toast then
 * names the days it dropped. Before this, the participant only learned from an
 * anonymous reason ("Nicht hinzugefügt: Diese Zeit ist belegt") that something
 * was dropped, and had to compare the timeline to find out what.
 */
import { test, expect } from '@playwright/test';
import {
  chooseActivity,
  clearActivities,
  dayEvents,
  openDiary,
  participantsUrl,
} from './helpers.js';

/**
 * Fill Wednesday 10:00-11:00 with two different activities through the API.
 *
 * Two is `max_overlap` in this fixture, so a third entry no longer fits. Seeding
 * them directly keeps this spec about the hint: two saves through the form would
 * also mean two toasts, and a visible toast covers the panel's footer buttons
 * until it times out.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} pid
 */
async function fillWednesday(request, pid) {
  const diary = await (await request.get(`${participantsUrl()}/${pid}/diary`)).json();
  const response = await request.post(`${participantsUrl()}/${pid}/activities`, {
    data: {
      items: [
        { code: 1101, name: 'Schlafen' },
        { code: 1102, name: 'Ausruhen' },
      ].map((activity) => ({
        client_uuid: `e2e-hint-${activity.code}`,
        timeline_key: diary.timeline.key,
        activity_code: activity.code,
        activity_name: activity.name,
        start_minutes: 600,
        end_minutes: 660,
        day_label_indexes: [2],
      })),
    },
  });
  expect(response.ok(), 'filling Wednesday 10:00-11:00').toBeTruthy();
}

test.describe('multi-day preview', () => {
  const pid = 'diary_01';
  const hint = '[data-slot="also-on-hint"]';

  test.beforeEach(async ({ request }) => clearActivities(request, pid));
  test.afterEach(async ({ request }) => clearActivities(request, pid));

  test('counts the days the entry will land on', async ({ page }) => {
    await openDiary(page, pid);
    await chooseActivity(page, 1101);

    // One day is the everyday save; the form keeps quiet.
    await expect(page.locator(hint)).toBeHidden();

    await page.locator('#form-start').selectOption('600');
    await page.locator('#form-end').selectOption('660');
    // Checked after the time fields: changing the start re-syncs the chips to the
    // day the form currently shows.
    await page.locator('.t-day-chip input[name="days"][value="1"]').check();

    await expect(page.locator(hint)).toHaveText('Wird an 2 Tagen eingetragen');

    await page.locator('.t-day-chip input[name="days"][value="1"]').uncheck();
    await expect(page.locator(hint)).toBeHidden();
  });

  test('names a day whose slot is already full, before and after saving', async ({ page, request }) => {
    await fillWednesday(request, pid);
    await openDiary(page, pid);
    await expect(dayEvents(page, 2)).toHaveCount(2);

    await chooseActivity(page, 1104);
    await page.locator('#form-day').selectOption('0');
    await page.locator('#form-start').selectOption('600');
    await page.locator('#form-end').selectOption('660');
    await page.locator('.t-day-chip input[name="days"][value="2"]').check();

    await expect(page.locator(hint)).toHaveText(
      'Wird an 1 von 2 Tagen eingetragen · Mittwoch übersprungen'
    );

    await page.locator('[data-slot="actions"] .t-btn--primary').click();

    await expect(dayEvents(page, 0)).toHaveCount(1);
    await expect(dayEvents(page, 2)).toHaveCount(2);
    await expect(page.locator('.t-toast')).toContainText(
      'Nicht hinzugefügt: Mittwoch (Diese Zeit ist belegt)'
    );
  });
});

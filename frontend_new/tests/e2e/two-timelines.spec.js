/**
 * A study whose activities config still defines a second timeline.
 *
 * The rewrite supports one timeline per study (D1), so the deployment's
 * `multiTimelinePolicy` decides what a participant sees. The default is
 * `ignore`: only the timeline the diary resolved to. This spec pins both halves
 * of that - the picker, and the diary read - because a participant who saw the
 * second timeline's rows could edit a diary they are not supposed to have.
 *
 * The fixture (`newui_14_two_timelines`) uses disjoint codes: 11xx on `primary`,
 * 21xx on `secondary`. The participant is `two_01`.
 */
import { test, expect } from '@playwright/test';
import {
  CATALOGUE,
  ORIGIN,
  clearActivities,
  isPhone,
  openDiary,
  openPanel,
} from './helpers.js';

const STUDY = 'newui_14_two_timelines';
const PID = 'two_01';
const API = `${ORIGIN}/tud_backend/api/studies/${STUDY}/participants/${PID}`;

test.describe('a study with two timelines', () => {
  test.beforeEach(async ({ request }) => clearActivities(request, PID, STUDY));
  test.afterEach(async ({ request }) => clearActivities(request, PID, STUDY));

  test('offers only the resolved timeline', async ({ page }) => {
    await openDiary(page, PID, STUDY);
    await openPanel(page);

    // Primary's activities are there ...
    await expect(
      page.locator(`${CATALOGUE} .t-activity[data-activity-code="1101"]`)
    ).toBeVisible();
    // ... and the second timeline's are not, under any name.
    await expect(page.locator(`${CATALOGUE} .t-activity[data-activity-code="2101"]`)).toHaveCount(0);
    await expect(page.getByText('Musik hören')).toHaveCount(0);
  });

  test('reads only the rows of the resolved timeline', async ({ page, request }) => {
    // Seed one row per timeline through the API, so the assertion is about what
    // the app shows and not about what it can create.
    for (const [code, timeline] of [
      [1101, 'primary'],
      [2101, 'secondary'],
    ]) {
      const response = await request.post(`${API}/activities`, {
        data: {
          items: [
            {
              client_uuid: `e2e-${timeline}`,
              timeline_key: timeline,
              activity_code: code,
              activity_name: timeline === 'primary' ? 'Schlafen' : 'Musik hören',
              start_minutes: timeline === 'primary' ? 480 : 0,
              end_minutes: timeline === 'primary' ? 600 : 1440,
              day_label_indexes: [0],
            },
          ],
        },
      });
      expect(response.ok(), `creating the ${timeline} row`).toBeTruthy();
    }

    await openDiary(page, PID, STUDY);

    await expect(page.locator('.t-event')).toHaveCount(1);
    await expect(page.locator('.t-event__title')).toHaveText('Schlafen');
  });

  test('writes a new activity on the resolved timeline', async ({
    page,
    request,
  }, testInfo) => {
    await openDiary(page, PID, STUDY);
    await openPanel(page);
    await page.locator(`${CATALOGUE} .t-activity[data-activity-code="1101"]`).click();
    await page.locator('#form-start').selectOption('480');
    await page.locator('#form-end').selectOption('540');
    await page.locator('[data-slot="actions"] .t-btn--primary').click();
    await expect(page.locator('.t-event__title')).toHaveText('Schlafen');

    // The row the server stored names the timeline the client sent.
    const diary = await (await request.get(`${API}/diary`)).json();
    expect(diary.activities.map((activity) => activity.timeline_key)).toEqual(['primary']);

    if (isPhone(testInfo)) {
      await expect(page.locator('#dialog-host')).toBeHidden();
    }
  });
});

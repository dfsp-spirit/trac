/**
 * The surroundings block under the activity form's time row.
 *
 * It exists for the phone: the form is a modal that covers the timeline, so
 * "did I sleep until 06:00 or 06:10?" has no answer inside the form without it.
 * It also names an entry that runs at the same time as the one being entered -
 * legitimate data (music while cooking), so a row, not a warning.
 *
 * Every row is labelled ("Davor", "Gleichzeitig", "Danach"), which is the whole
 * point of the layout: an unlabelled "Schlafen ab 00:00" reads as part of the
 * entry being edited.
 *
 * The first entry is seeded through the API, so each test opens the panel once:
 * the subject is the block, not the save path (covered by activity-lifecycle).
 *
 * Uses the `newui_06_diary` fixture (1101 = Schlafen, German UI).
 */
import { test, expect } from '@playwright/test';
import {
  chooseActivity,
  clearActivities,
  openDiary,
  participantsUrl,
  setTime,
  clockValue,
} from './helpers.js';

// `diary_02` is the fixture's second participant, used by one other spec; the
// suite runs one worker and every spec clears before and after itself.
const PID = 'diary_02';

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{ start: number, end: number, days?: number[] }} range Day-relative
 *   minutes, and the days when the routine repeats.
 */
async function seedSchlafen(request, { start, end, days = [0] }) {
  const diary = await (await request.get(`${participantsUrl()}/${PID}/diary`)).json();
  const response = await request.post(`${participantsUrl()}/${PID}/activities`, {
    data: {
      items: [
        {
          client_uuid: `e2e-neighbour-sleep-${days.length}`,
          timeline_key: diary.timeline.key,
          activity_code: 1101,
          activity_name: 'Schlafen',
          start_minutes: start,
          end_minutes: end,
          day_label_indexes: days,
        },
      ],
    },
  });
  expect(response.ok(), 'seeding the previous entry').toBeTruthy();
}

test.describe('time neighbours', () => {
  test.beforeEach(async ({ request }) => clearActivities(request, PID));
  test.afterEach(async ({ request }) => clearActivities(request, PID));

  test('names the previous entry and offers to continue it', async ({
    page,
    request,
  }) => {
    await seedSchlafen(request, { start: 0, end: 360 }); // 00:00-06:00
    await openDiary(page, PID);
    await chooseActivity(page, 1101);

    const labels = page.locator('.t-neighbours__label');
    const values = page.locator('.t-neighbours__value');
    const snap = page.locator('.t-neighbours button');

    await setTime(page, '#form-start', 370); // guessed 06:10
    await setTime(page, '#form-end', 400);
    await expect(labels).toHaveText(['Davor']);
    await expect(values).toHaveText(['Schlafen bis 06:00']);
    await expect(snap).toHaveText(/An Schlafen anschließen \(06:00\)/);

    // The whole point of the chip: no memory required, one tap.
    await snap.click();
    await expect(page.locator('#form-start')).toHaveValue(clockValue(360));
    // The length the participant chose is kept...
    await expect(page.locator('#form-end')).toHaveValue(clockValue(390));
    // ...and the entry now touches its neighbour: nothing left to snap.
    await expect(values).toHaveText(['Schlafen bis 06:00']);
    await expect(snap).toBeHidden();
  });

  test('names an entry that runs at the same time as this one', async ({
    page,
    request,
  }) => {
    await seedSchlafen(request, { start: 0, end: 370 }); // 00:00-06:10
    await openDiary(page, PID);
    await chooseActivity(page, 1101);

    await setTime(page, '#form-start', 360); // 06:00
    await setTime(page, '#form-end', 390); // 06:30

    // 10 minutes on top of an existing entry is allowed by max_overlap, so the
    // save would succeed without a word - this row is the only trace of it. It is
    // stated, not warned about: overlapping records are legitimate.
    await expect(page.locator('.t-neighbours__label')).toHaveText([
      'Gleichzeitig',
    ]);
    await expect(page.locator('.t-neighbours__value')).toHaveText([
      'Schlafen 06:00–06:10, 10 Min.',
    ]);
  });

  test('a neighbour on another day names its weekday', async ({ page, request }) => {
    // A routine filled on all seven days: the entry after Monday's morning one
    // is Tuesday's, and a bare "ab 00:00" would read as today's midnight.
    await seedSchlafen(request, { start: 0, end: 540, days: [0, 1, 2, 3, 4, 5, 6] });
    await openDiary(page, PID);
    await chooseActivity(page, 1101);

    await expect(page.locator('.t-neighbours__label')).toHaveText([
      'Davor',
      'Danach',
    ]);
    await expect(page.locator('.t-neighbours__value')).toHaveText([
      'Schlafen bis 09:00',
      'Schlafen ab Dienstag 00:00',
    ]);
  });

  test('a single entry on the day stays one phrase per side', async ({ page, request }) => {
    // The same activity on one day only: nothing is on the other side, so the
    // block must not invent a second "Schlafen".
    await seedSchlafen(request, { start: 0, end: 540 });
    await openDiary(page, PID);
    await chooseActivity(page, 1101);

    await expect(page.locator('.t-neighbours__label')).toHaveText(['Davor']);
    await expect(page.locator('.t-neighbours__value')).toHaveText([
      'Schlafen bis 09:00',
    ]);
  });

  test('says nothing while the day around the range is empty', async ({ page }) => {
    await openDiary(page, PID);
    await chooseActivity(page, 1101);
    await expect(page.locator('.t-neighbours')).toBeHidden();
  });
});

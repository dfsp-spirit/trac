/**
 * The boundary hint under the activity form's time row.
 *
 * It exists for the phone: the form is a modal that covers the timeline, so
 * "did I sleep until 06:00 or 06:10?" has no answer inside the form without this
 * line. It also covers the case that would otherwise pass silently - one
 * tolerated overlap (`max_overlap`) is accepted by the rules, so nothing else
 * would ever mention it.
 *
 * The first entry is seeded through the API, so each test opens the panel once:
 * the subject is the hint, not the save path (covered by activity-lifecycle).
 *
 * Uses the `newui_06_diary` fixture (1101 = Schlafen, German UI).
 */
import { test, expect } from '@playwright/test';
import {
  chooseActivity,
  clearActivities,
  openDiary,
  participantsUrl,
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

    const hint = page.locator('.t-neighbours .t-hint');
    const snap = page.locator('.t-neighbours button');

    await page.locator('#form-start').selectOption('370'); // guessed 06:10
    await page.locator('#form-end').selectOption('400');
    await expect(hint).toHaveText(/Schlafen bis 06:00/);
    await expect(snap).toHaveText(/An Schlafen anschließen \(06:00\)/);

    // The whole point of the chip: no memory required, one tap.
    await snap.click();
    await expect(page.locator('#form-start')).toHaveValue('360');
    // The length the participant chose is kept...
    await expect(page.locator('#form-end')).toHaveValue('390');
    // ...and the entry now touches its neighbour: nothing left to snap.
    await expect(hint).toHaveText(/Schlafen bis 06:00/);
    await expect(snap).toBeHidden();
  });

  test('mentions a tolerated overlap that the rules let through', async ({
    page,
    request,
  }) => {
    await seedSchlafen(request, { start: 0, end: 370 }); // 00:00-06:10
    await openDiary(page, PID);
    await chooseActivity(page, 1101);

    await page.locator('#form-start').selectOption('360'); // 06:00
    await page.locator('#form-end').selectOption('390'); // 06:30

    // 10 minutes on top of an existing entry is allowed by max_overlap, so the
    // save would succeed without a word - the hint is the only warning.
    await expect(page.locator('.t-neighbours .t-hint')).toHaveText(
      /Überlappt Schlafen \(06:00–06:10\), 10 Min\./
    );
  });

  test('a neighbour on another day names its weekday', async ({ page, request }) => {
    // A routine filled on all seven days: the entry after Monday's morning one
    // is Tuesday's, and a bare "ab 00:00" would read as today's midnight.
    await seedSchlafen(request, { start: 0, end: 540, days: [0, 1, 2, 3, 4, 5, 6] });
    await openDiary(page, PID);
    await chooseActivity(page, 1101);

    await expect(page.locator('.t-neighbours .t-hint')).toHaveText(
      'Schlafen bis 09:00 · Schlafen ab 00:00 (Dienstag)'
    );
  });

  test('a single entry on the day stays one phrase per side', async ({ page, request }) => {
    // The same activity on one day only: nothing is on the other side, so the
    // line must not invent a second "Schlafen".
    await seedSchlafen(request, { start: 0, end: 540 });
    await openDiary(page, PID);
    await chooseActivity(page, 1101);

    await expect(page.locator('.t-neighbours .t-hint')).toHaveText('Schlafen bis 09:00');
  });

  test('says nothing while the day around the range is empty', async ({ page }) => {
    await openDiary(page, PID);
    await chooseActivity(page, 1101);
    await expect(page.locator('.t-neighbours')).toBeHidden();
  });
});

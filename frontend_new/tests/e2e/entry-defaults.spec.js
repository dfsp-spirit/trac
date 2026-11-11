/**
 * What a new entry starts with when the participant did not point at a time.
 *
 * One rule (`domain/suggestSlot.js`, pinned by `suggest-slot.test.js`): the day
 * and minute the participant is looking at, moved into that day's free time, and
 * an hour - shortened by the next entry. This spec pins the wiring, which is
 * where the old behaviour went wrong: the catalogue column used to open on a
 * fixed Monday 08:00 whatever the timeline showed.
 *
 * Uses the `newui_06_diary` fixture (1101 = Schlafen, German UI).
 */
import { test, expect } from '@playwright/test';
import {
  CATALOGUE,
  chooseActivity,
  clearActivities,
  clockToMinutes,
  clockValue,
  isPhone,
  openDiary,
  participantsUrl,
  setTime,
} from './helpers.js';

const PID = 'diary_02';

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{ start: number, end: number }} range Day-relative minutes.
 */
async function seedSchlafen(request, { start, end }) {
  const diary = await (await request.get(`${participantsUrl()}/${PID}/diary`)).json();
  const response = await request.post(`${participantsUrl()}/${PID}/activities`, {
    data: {
      items: [
        {
          client_uuid: 'e2e-defaults-sleep',
          timeline_key: diary.timeline.key,
          activity_code: 1101,
          activity_name: 'Schlafen',
          start_minutes: start,
          end_minutes: end,
          day_label_indexes: [0],
        },
      ],
    },
  });
  expect(response.ok(), 'seeding the morning entry').toBeTruthy();
}

/** @param {import('@playwright/test').Page} page */
function formStart(page) {
  return page.locator('#form-start');
}

/** @param {import('@playwright/test').Page} page */
function formEnd(page) {
  return page.locator('#form-end');
}

test.describe('entry defaults', () => {
  test.beforeEach(async ({ request }) => clearActivities(request, PID));
  test.afterEach(async ({ request }) => clearActivities(request, PID));

  test('the catalogue opens on the day the participant scrolled to', async ({
    page,
  }, testInfo) => {
    test.skip(
      isPhone(testInfo),
      'the phone panel is opened by the add button, which already passes the day'
    );

    await openDiary(page, PID);

    // Scroll the diary itself, exactly like a participant looking at Thursday.
    await page
      .locator('#days .t-timeline-day[data-day-index="3"]')
      .scrollIntoViewIfNeeded();
    await expect(page.locator('.t-rail__row[data-day-index="3"]')).toHaveAttribute(
      'aria-current',
      'true'
    );

    // Picking from the column then belongs to that day, not to Monday.
    await page.locator(`${CATALOGUE} .t-activity[data-activity-code="1101"]`).click();
    await expect(page.locator('#form-day')).toHaveValue('3');
  });

  test('a suggested range never lands on top of an existing entry', async ({
    page,
    request,
  }) => {
    // 00:00-07:00 is taken, so the suggestion has to start after it whatever
    // minute the view happens to be at.
    await seedSchlafen(request, { start: 0, end: 420 });
    await openDiary(page, PID);
    await page
      .locator('#days .t-timeline-day[data-day-index="0"]')
      .scrollIntoViewIfNeeded();
    await expect(page.locator('.t-rail__row[data-day-index="0"]')).toHaveAttribute(
      'aria-current',
      'true'
    );

    await chooseActivity(page, 1101);

    await expect(page.locator('#form-day')).toHaveValue('0');
    const start = clockToMinutes(await formStart(page).inputValue());
    const end = clockToMinutes(await formEnd(page).inputValue());
    // After the morning entry, and an hour long: still plenty of day left.
    expect(start).toBeGreaterThanOrEqual(420);
    expect(end - start).toBe(60);
  });

  test('"add another" continues at the end of what was just saved', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'only the phone shows the second save button');

    await openDiary(page, PID);
    await chooseActivity(page, 1101);
    await setTime(page, '#form-start', 480);
    await setTime(page, '#form-end', 540);
    await page.locator('[data-slot="save-another"]').click();

    // The form covers the timeline on a phone, so the only place the participant
    // can be looking is the end of the entry they just saved.
    await expect(page.locator(`${CATALOGUE} .t-activity`).first()).toBeVisible();
    await chooseActivity(page, 1101);
    await expect(formStart(page)).toHaveValue(clockValue(540));
    await expect(formEnd(page)).toHaveValue(clockValue(600));
  });
});

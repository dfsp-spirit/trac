/**
 * Shared setup for the rewrite's diary specs.
 *
 * The fixture studies are seeded by the import, but their activities persist
 * between runs. Clearing through the public diary API keeps local runs
 * repeatable without reaching into the database.
 */
import { expect } from '@playwright/test';

export const BASE_URL =
  process.env.PLAYWRIGHT_NEW_FRONTEND_URL || 'http://127.0.0.1:3000/report-new/';
export const ORIGIN = new URL(BASE_URL).origin;
export const STUDY = 'newui_06_diary';

/**
 * The catalogue list without the "Used recently" shortcut row above it: once the
 * participant has logged something, the same activity code can appear twice.
 */
export const CATALOGUE = '.t-activity-group[data-group="catalogue"]';

/**
 * Pick an activity from the catalogue (never from the shortcut row).
 *
 * @param {import('@playwright/test').Page} page
 * @param {number | string} code
 */
export function chooseActivity(page, code) {
  return page.locator(`${CATALOGUE} .t-activity[data-activity-code="${code}"]`).click();
}

/** @param {string} [study] */
export function participantsUrl(study = STUDY) {
  return `${ORIGIN}/tud_backend/api/studies/${study}/participants`;
}

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} pid
 * @param {string} [study]
 */
export async function clearActivities(request, pid, study = STUDY) {
  const base = participantsUrl(study);
  const response = await request.get(`${base}/${pid}/diary`);
  expect(response.ok(), `loading diary for ${pid}`).toBeTruthy();
  const diary = await response.json();
  for (const activity of diary.activities) {
    const deleted = await request.delete(
      `${base}/${pid}/activities/${encodeURIComponent(activity.client_uuid)}`
    );
    expect(deleted.ok(), `deleting ${activity.client_uuid}`).toBeTruthy();
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} pid
 * @param {string} [study]
 */
export async function openDiary(page, pid, study = STUDY) {
  await page.goto(`${BASE_URL}?study=${study}&pid=${pid}`);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/diary');
  await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
}

/**
 * Add one activity through the catalogue and the form.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} code Activity code from the fixture's catalogue.
 * @param {{ start: number, end: number }} range Day-relative minutes.
 */
export async function addActivity(page, code, { start, end }) {
  await chooseActivity(page, code);
  await page.locator('#form-start').selectOption(String(start));
  await page.locator('#form-end').selectOption(String(end));
  await page.locator('[data-slot="actions"] .t-btn--primary').click();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ start: number, end: number }} range
 */
export async function addSchlafen(page, range) {
  await addActivity(page, 1101, range);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} dayIndex
 */
export function dayEvents(page, dayIndex) {
  return page.locator(`#days .t-timeline-day[data-day-index="${dayIndex}"] .t-event`);
}

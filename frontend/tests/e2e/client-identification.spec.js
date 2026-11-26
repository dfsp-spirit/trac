/**
 * Browser/device identification, from the browser to the database (D28).
 *
 * `data/clientInfo.js` and `domain/clientInfo.js` are unit-tested, and the
 * backend has its own tests for the export columns - but nothing proved the two
 * halves meet. The only way to see that is to read the participant back out of
 * the admin export, which is also the only place the data is exposed (it is
 * device data, not study data).
 *
 * `newui_13_clientinfo` is the one fixture with `save_browser_identification`
 * enabled; `newui_06_diary` is the control that must store nothing.
 */
import { test, expect } from '@playwright/test';
import { ORIGIN, adminAuth, openDiary } from './helpers.js';

const STUDY = 'newui_13_clientinfo';
const CAPTURE_PID = 'client_01';
/** A study with identification switched off. */
const CONTROL_STUDY = 'newui_06_diary';
const CONTROL_PID = 'diary_02';

/**
 * One row per participant, including the `client_*` block when the study
 * collects it.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} study
 */
async function participantRows(request, study) {
  const auth = adminAuth();
  const response = await request.get(
    `${ORIGIN}/tud_backend/api/admin/export/${study}/participants?format=json`,
    { headers: { Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}` } }
  );
  expect(response.ok(), `exporting ${study}`).toBeTruthy();
  const body = await response.json();
  return /** @type {any[]} */ (body.data);
}

test.describe('browser identification', () => {
  test('a study that asks for it stores what the browser sent', async ({ page, request }) => {
    await openDiary(page, CAPTURE_PID, STUDY);

    // Best-effort by design: the app does not wait for the POST, so give it a
    // moment to land rather than asserting on a race.
    await expect
      .poll(
        async () => {
          const rows = await participantRows(request, STUDY);
          return rows.find((row) => row.participant_id === CAPTURE_PID)?.client_info_collected;
        },
        { timeout: 15_000 }
      )
      .toBe(true);

    const rows = await participantRows(request, STUDY);
    const row = rows.find((entry) => entry.participant_id === CAPTURE_PID);
    expect(row).toBeTruthy();
    if (!row) return;

    // The values the browser can know: a real user agent, a viewport, a zone.
    expect(row.client_user_agent).toContain('Mozilla');
    expect(row.client_viewport_width).toBeGreaterThan(0);
    expect(row.client_viewport_height).toBeGreaterThan(0);
    expect(row.client_timezone).toBeTruthy();
    expect(row.client_info_captured_at).toBeTruthy();
    // The raw blob is kept as well, so a future field does not need a migration.
    expect(JSON.parse(row.client_info_json).schema_version).toBeTruthy();
  });

  test('a study that does not ask for it stores nothing', async ({ page, request }) => {
    await openDiary(page, CONTROL_PID, CONTROL_STUDY);
    // Give a stray POST the same chance it gets above, then assert absence.
    await page.waitForTimeout(1_500);

    const rows = await participantRows(request, CONTROL_STUDY);
    const row = rows.find((entry) => entry.participant_id === CONTROL_PID);
    expect(row).toBeTruthy();
    if (!row) return;

    // The study collects nothing, so the export carries no `client_*` block at
    // all - the presence of the block is what marks collection as configured.
    expect(row.client_user_agent).toBeUndefined();
    expect(row.client_info_collected).toBeUndefined();
  });
});

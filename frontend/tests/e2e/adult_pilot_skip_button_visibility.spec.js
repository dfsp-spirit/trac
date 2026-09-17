const { test, expect } = require('@playwright/test');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

const STUDY_NAME = 'adult_pilot_de';

const ADMIN_BASE_URL =
  process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://127.0.0.1:3000/tud_backend';
const API_BASE_URL =
  process.env.PLAYWRIGHT_API_BASE_URL || `${ADMIN_BASE_URL}/api`;
const ADMIN_USER =
  process.env.PLAYWRIGHT_ADMIN_USER || 'timeusediary_api_admin';
const ADMIN_PASS =
  process.env.PLAYWRIGHT_ADMIN_PASS || 'timeusediary_api_admin_password';

function getBasicAuthHeader() {
  const auth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  return { Authorization: `Basic ${auth}` };
}

function getParticipantIdForProject(projectName) {
  if (projectName === 'firefox') {
    return 'claudia';
  }
  if (projectName === 'webkit') {
    return 'bernd';
  }
  return 'sophia';
}

test('adult_pilot_de hides skip reporting button when allow_skip_timeuse is false', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !ADMIN_USER || !ADMIN_PASS,
    'Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS to run this e2e test.'
  );

  const participantId = getParticipantIdForProject(testInfo.project.name);
  const adminHeaders = getBasicAuthHeader();

  const resetResponse = await request.delete(
    `${API_BASE_URL}/admin/studies/${STUDY_NAME}/participants/${participantId}/data`,
    { headers: adminHeaders }
  );
  if (resetResponse.status() === 401 || resetResponse.status() === 403) {
    test.skip(
      true,
      'Admin credentials were rejected. Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS correctly.'
    );
  }
  expect(
    resetResponse.ok(),
    `reset endpoint failed (${resetResponse.status()}): ${await resetResponse.text()}`
  ).toBeTruthy();

  const reseedExternalTasksResponse = await request.post(
    `${API_BASE_URL}/admin/studies/${STUDY_NAME}/participants/${participantId}/external-tasks/reseed`,
    { headers: adminHeaders }
  );
  if (reseedExternalTasksResponse.status() === 404) {
    test.skip(
      true,
      'Backend does not expose external-task reseed endpoint yet. Restart backend on the current code revision.'
    );
  }
  expect(
    reseedExternalTasksResponse.ok(),
    `reseed endpoint failed (${reseedExternalTasksResponse.status()}): ${await reseedExternalTasksResponse.text()}`
  ).toBeTruthy();

  const consentResponse = await request.post(
    `${API_BASE_URL}/studies/${STUDY_NAME}/participants/${participantId}/consent`,
    { data: { consent_given: true } }
  );
  expect(consentResponse.ok()).toBeTruthy();

  const instructionsResponse = await request.post(
    `${API_BASE_URL}/studies/${STUDY_NAME}/participants/${participantId}/instructions/complete`,
    { data: { completed: true } }
  );
  expect(instructionsResponse.ok()).toBeTruthy();

  await page.goto(
    `index.html?study_name=${STUDY_NAME}&pid=${participantId}&lang=de&instructions=completed`,
    {
      waitUntil: 'domcontentloaded',
    }
  );

  // Wait until the diary UI is actually up (enterStudyIfNeeded also asserts
  // that we stayed on index.html).  Asserting on a half-loaded page, or on a
  // page that is about to redirect a submitted participant to the tasks or
  // thank-you page, would let this test pass for the wrong reason.
  await enterStudyIfNeeded(page);
  await expect(page.locator('#currentDayDisplay')).toBeVisible();
  await expect(page.locator('#skipReportingBtn')).toBeHidden();
});

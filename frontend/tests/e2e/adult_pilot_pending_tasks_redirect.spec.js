const { test, expect } = require('@playwright/test');

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

const PENDING_TASKS_PARTICIPANT_POOL = [
  'pending_01',
  'pending_02',
  'pending_03',
  'pending_04',
  'pending_05',
  'pending_06',
  'pending_07',
  'pending_08',
  'pending_09',
  'pending_10',
  'pending_11',
  'pending_12',
];

function pickParticipantIdForRun(testInfo) {
  const repeatEachIndex = Number.isInteger(testInfo.repeatEachIndex)
    ? testInfo.repeatEachIndex
    : 0;
  const poolIndex = repeatEachIndex % PENDING_TASKS_PARTICIPANT_POOL.length;
  return PENDING_TASKS_PARTICIPANT_POOL[poolIndex];
}

function pickSubmissionTemplate(activitiesConfig) {
  const timelineConfig = activitiesConfig?.timeline || {};

  for (const [timelineKey, timelineValue] of Object.entries(timelineConfig)) {
    const mode = timelineValue?.mode || 'single-choice';
    const categories = Array.isArray(timelineValue?.categories)
      ? timelineValue.categories
      : [];

    for (const category of categories) {
      const categoryName = category?.name;
      const activities = Array.isArray(category?.activities)
        ? category.activities
        : [];

      for (const activity of activities) {
        const activityName = activity?.name;
        const activityCode = activity?.code;
        if (!activityName) {
          continue;
        }
        if (
          (mode === 'single-choice' || mode === 'multiple-choice') &&
          typeof activityCode !== 'number'
        ) {
          continue;
        }

        return {
          timelineKey,
          mode,
          categoryName,
          activityName,
          activityCode,
        };
      }
    }
  }

  throw new Error('Could not determine a valid activity template from activities-config.');
}

function pickRequiredTimelineTemplate(activitiesConfig) {
  const timelineConfig = activitiesConfig?.timeline || {};
  const fallbackTemplate = pickSubmissionTemplate(activitiesConfig);
  let requiredTimelineKey = null;
  let requiredMinCoverage = 0;

  for (const [timelineKey, timelineValue] of Object.entries(timelineConfig)) {
    const minCoverage = Number(timelineValue?.min_coverage || 0);
    if (minCoverage > requiredMinCoverage) {
      requiredMinCoverage = minCoverage;
      requiredTimelineKey = timelineKey;
    }
  }

  if (!requiredTimelineKey) {
    return fallbackTemplate;
  }

  const timelineValue = timelineConfig[requiredTimelineKey] || {};
  const mode = timelineValue?.mode || 'single-choice';
  const categories = Array.isArray(timelineValue?.categories)
    ? timelineValue.categories
    : [];

  for (const category of categories) {
    const categoryName = category?.name;
    const activities = Array.isArray(category?.activities)
      ? category.activities
      : [];

    for (const activity of activities) {
      const activityName = activity?.name;
      const activityCode = activity?.code;
      if (!activityName) {
        continue;
      }
      if (
        (mode === 'single-choice' || mode === 'multiple-choice') &&
        typeof activityCode !== 'number'
      ) {
        continue;
      }

      return {
        timelineKey: requiredTimelineKey,
        mode,
        categoryName,
        activityName,
        activityCode,
      };
    }
  }

  return fallbackTemplate;
}

test('adult_pilot_de: bernd with pending external tasks lands on tasks page after completion', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !ADMIN_USER || !ADMIN_PASS,
    'Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS to run this e2e test.'
  );

  const adminHeaders = getBasicAuthHeader();
  const participantId = pickParticipantIdForRun(testInfo);

  // Idempotency reset: remove prior participant data in this study while keeping assignment.
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

  // Ensure consent/instructions are marked complete so this test can focus on diary completion + redirect.
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

  const studyConfigResponse = await request.get(
    `${API_BASE_URL}/studies/${STUDY_NAME}/study-config?participant_id=${participantId}&lang=de`
  );
  expect(studyConfigResponse.ok()).toBeTruthy();
  const studyConfig = await studyConfigResponse.json();
  expect(Array.isArray(studyConfig.day_labels)).toBeTruthy();
  expect(studyConfig.day_labels.length).toBeGreaterThan(0);

  const activitiesConfigResponse = await request.get(
    `${API_BASE_URL}/studies/${STUDY_NAME}/activities-config?lang=de&participant_id=${participantId}`
  );
  expect(activitiesConfigResponse.ok()).toBeTruthy();
  const activitiesConfig = await activitiesConfigResponse.json();
  const template = pickRequiredTimelineTemplate(activitiesConfig);

  const payload = {
    timeline_key: template.timelineKey,
    activity: template.activityName,
    category: template.categoryName,
    start_minutes: 240,
    end_minutes: 1680,
    mode: template.mode,
  };

  if (template.mode === 'single-choice') {
    payload.code = template.activityCode;
  } else if (template.mode === 'multiple-choice') {
    payload.codes = [template.activityCode];
  }

  for (const dayLabel of studyConfig.day_labels) {
    const submitResponse = await request.post(
      `${API_BASE_URL}/studies/${STUDY_NAME}/participants/${participantId}/day_labels/${dayLabel.name}/activities`,
      { data: { activities: [payload] } }
    );
    expect(submitResponse.ok()).toBeTruthy();
  }

  await page.goto(
    `index.html?study_name=${STUDY_NAME}&pid=${participantId}&lang=de&instructions=completed`,
    {
      waitUntil: 'domcontentloaded',
    }
  );

  await expect(page).toHaveURL(/pages\/tasks\.html/);
  await expect(page.locator('#tasks-list .task-item')).toHaveCount(2);
});

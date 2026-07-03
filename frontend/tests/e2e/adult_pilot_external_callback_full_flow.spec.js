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

  throw new Error(
    'Could not determine a valid activity template from activities-config.'
  );
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

function getParticipantIdForProject(projectName) {
  if (projectName === 'firefox') {
    return 'sophia';
  }
  if (projectName === 'webkit') {
    return 'claudia';
  }
  return 'bernd';
}

test('adult_pilot_de closed-study full task flow with simulated external callback pages', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !ADMIN_USER || !ADMIN_PASS,
    'Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS to run this e2e test.'
  );

  const adminHeaders = getBasicAuthHeader();
  const participantId = getParticipantIdForProject(testInfo.project.name);

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

  await page.context().route('**/external-tasks/*/launch?*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const taskKeyMatch = requestUrl.pathname.match(/\/external-tasks\/([^/]+)\/launch/);
    const taskKey = taskKeyMatch ? taskKeyMatch[1] : null;
    const token = requestUrl.searchParams.get('assigned_token') || '';

    const callbackUrl = new URL('http://127.0.0.1:3000/report/pages/tasks.html');
    callbackUrl.searchParams.set('study_name', STUDY_NAME);
    callbackUrl.searchParams.set('pid', participantId);
    callbackUrl.searchParams.set('lang', 'de');
    callbackUrl.searchParams.set('completion_status', 'completed');
    if (taskKey && token) {
      callbackUrl.searchParams.set('callback_task_key', taskKey);
      callbackUrl.searchParams.set('callback_token', token);
    }

    const body = `<!DOCTYPE html>
<html lang="de">
  <head><meta charset="utf-8"><title>Mock External Provider</title></head>
  <body>
    <h1>Mock External Provider</h1>
    <p id="provider-path">${requestUrl.pathname}</p>
    <button id="completeTask" onclick="window.location.href='${callbackUrl.toString()}'">Task abschliessen</button>
  </body>
</html>`;

    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body,
    });
  });

  await page.goto(
    `index.html?study_name=${STUDY_NAME}&pid=${participantId}&lang=de`,
    {
      waitUntil: 'domcontentloaded',
    }
  );

  await expect(page).toHaveURL(/pages\/tasks\.html/);
  await expect(page.locator('#tasks-list .task-item')).toHaveCount(3);

  const taskOneLink = page.locator('#tasks-list .task-item a.task-link', {
    hasText: 'Umfrage zu Depressionssymptomen ausfüllen',
  });
  await expect(taskOneLink).toBeVisible();
  await taskOneLink.click();

  await expect(page).toHaveURL(/external-tasks\/depression_survey\/launch/);
  await page.locator('#completeTask').click();

  await expect(page).toHaveURL(/pages\/tasks\.html/);
  const taskOneRow = page.locator('#tasks-list .task-item', {
    hasText: 'Umfrage zu Depressionssymptomen ausfüllen',
  });
  await expect(taskOneRow.locator('.task-status')).toContainText(
    'Bereits erledigt'
  );

  const taskTwoLink = page.locator('#tasks-list .task-item a.task-link', {
    hasText: 'Bankdaten eingeben',
  });
  await expect(taskTwoLink).toBeVisible();
  await taskTwoLink.click();

  await expect(page).toHaveURL(/external-tasks\/payment_info\/launch/);
  await page.locator('#completeTask').click();

  await expect(page).toHaveURL(/pages\/tasks\.html/);

  const taskTwoRow = page.locator('#tasks-list .task-item', {
    hasText: 'Bankdaten eingeben',
  });
  await expect(taskTwoRow.locator('.task-status')).toContainText(
    'Bereits erledigt'
  );

  const continueLink = page.locator('#continue-link');
  await expect(continueLink).toBeVisible();
  await continueLink.click();

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
});

test('adult_pilot_de full external-task flow preserves return_url to thank-you page', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !ADMIN_USER || !ADMIN_PASS,
    'Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS to run this e2e test.'
  );

  const adminHeaders = getBasicAuthHeader();
  const participantId = getParticipantIdForProject(testInfo.project.name);
  const rawReturnUrl = 'https://example.org/finalize?session=adult-pilot-flow-1&src=trac';

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

  await page.context().route('**/external-tasks/*/launch?*', async (route) => {
    const requestUrl = new URL(route.request().url());
    const taskKeyMatch = requestUrl.pathname.match(/\/external-tasks\/([^/]+)\/launch/);
    const taskKey = taskKeyMatch ? taskKeyMatch[1] : null;
    const token = requestUrl.searchParams.get('assigned_token') || '';

    // Simulate an external provider that does NOT preserve return_url in callback URL.
    const callbackUrl = new URL('http://127.0.0.1:3000/report/pages/tasks.html');
    callbackUrl.searchParams.set('study_name', STUDY_NAME);
    callbackUrl.searchParams.set('pid', participantId);
    callbackUrl.searchParams.set('lang', 'de');
    callbackUrl.searchParams.set('completion_status', 'completed');
    if (taskKey && token) {
      callbackUrl.searchParams.set('callback_task_key', taskKey);
      callbackUrl.searchParams.set('callback_token', token);
    }

    const body = `<!DOCTYPE html>
<html lang="de">
  <head><meta charset="utf-8"><title>Mock External Provider</title></head>
  <body>
    <h1>Mock External Provider</h1>
    <button id="completeTask" onclick="window.location.href='${callbackUrl.toString()}'">Task abschliessen</button>
  </body>
</html>`;

    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body,
    });
  });

  await page.goto(
    `index.html?study_name=${STUDY_NAME}&pid=${participantId}&lang=de&return_url=${encodeURIComponent(rawReturnUrl)}`,
    {
      waitUntil: 'domcontentloaded',
    }
  );

  await expect(page).toHaveURL(/pages\/tasks\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(
    rawReturnUrl
  );

  const taskOneLink = page.locator('#tasks-list .task-item a.task-link', {
    hasText: 'Umfrage zu Depressionssymptomen ausfüllen',
  });
  await expect(taskOneLink).toBeVisible();
  await taskOneLink.click();

  await expect(page).toHaveURL(/external-tasks\/depression_survey\/launch/);
  await page.locator('#completeTask').click();

  await expect(page).toHaveURL(/pages\/tasks\.html/);
  expect(new URL(page.url()).searchParams.get('return_url')).toBeNull();

  const taskOneRow = page.locator('#tasks-list .task-item', {
    hasText: 'Umfrage zu Depressionssymptomen ausfüllen',
  });
  await expect(taskOneRow.locator('.task-status')).toContainText(
    'Bereits erledigt'
  );

  const taskTwoLink = page.locator('#tasks-list .task-item a.task-link', {
    hasText: 'Bankdaten eingeben',
  });
  await expect(taskTwoLink).toBeVisible();
  await taskTwoLink.click();

  await expect(page).toHaveURL(/external-tasks\/payment_info\/launch/);
  await page.locator('#completeTask').click();

  await expect(page).toHaveURL(/pages\/tasks\.html/);
  expect(new URL(page.url()).searchParams.get('return_url')).toBeNull();

  const taskTwoRow = page.locator('#tasks-list .task-item', {
    hasText: 'Bankdaten eingeben',
  });
  await expect(taskTwoRow.locator('.task-status')).toContainText(
    'Bereits erledigt'
  );

  const continueLink = page.locator('#continue-link');
  await expect(continueLink).toBeVisible();
  await continueLink.click();

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(
    rawReturnUrl
  );

  const finalContinueLink = page.locator('#study-custom-message-end a.continue-link');
  await expect(finalContinueLink).toBeVisible();
  await expect(finalContinueLink).toHaveAttribute('href', rawReturnUrl);
});

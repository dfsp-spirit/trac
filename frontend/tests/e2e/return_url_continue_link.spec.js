const { test, expect } = require('@playwright/test');
test('return_url is preserved and shown as continue link on thank-you page', async ({
  page,
}) => {
  const rawReturnUrl = 'https://example.org/finish?token=abc123&next=1';
  const encodedReturnUrl = encodeURIComponent(rawReturnUrl);
  const startUrl = `index.html?study_name=default&lang=en&return_url=${encodedReturnUrl}`;

  await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(
    rawReturnUrl
  );

  await page.locator('#continueBtn').click();

  // Wait for navigation to complete - use element visibility instead of URL
  await expect(page.locator('#currentDayDisplay')).toBeVisible({ timeout: 15000 });
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(
    rawReturnUrl
  );

  await expect(page.locator('#skipReportingBtn')).toBeVisible();
  await expect(page.locator('#skipReportingBtn')).toBeEnabled();

  const skipModal = page.locator('#skipConfirmationModal');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('#skipReportingBtn').click();

    const modalVisible = await skipModal
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (modalVisible) {
      await page.locator('#confirmSkipOk').click();
      break;
    }

    const alreadyOnThankYou = /pages\/thank-you\.html/.test(page.url());
    if (alreadyOnThankYou) {
      break;
    }
  }

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(
    rawReturnUrl
  );

  const continueLink = page.locator(
    '#study-custom-message-end a.continue-link'
  );
  await expect(continueLink).toBeVisible();
  await expect(continueLink).toHaveText('Click here to continue.');
  await expect(continueLink).toHaveAttribute('href', rawReturnUrl);
});

test('tasks page shows assigned external task links for pending tasks', async ({
  page,
}) => {
  await page.route('**/api/studies/pw_external/study-config**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        study_name: 'Playwright External Task',
        study_name_short: 'pw_external',
        description: 'Mocked study config',
        allow_unlisted_participants: false,
        require_consent: false,
        data_collection_start: '2024-01-01T00:00:00Z',
        data_collection_end: '2028-12-31T23:59:59Z',
        default_language: 'en',
        activities_json_url: '/unused.json',
        supported_languages: ['en'],
        selected_language: 'en',
        study_text_end_completed: 'Thanks for finishing the TRAC study.',
        study_text_end_skipped: 'Skipped.',
        study_text_end_noconsent: 'No consent.',
        external_tasks: [
          {
            task_key: 'payment',
            name: 'Payment Survey',
            description: 'Complete payment handoff.',
            confirmation_type: 'none',
            assigned_token: 'tok-1',
            continuation_url:
              'https://example.org/payment?src=playwright&survey_token=tok-1',
          },
          {
            task_key: 'callback_only',
            name: 'Callback Task',
            description: 'Should not be shown yet.',
            confirmation_type: 'callback',
            assigned_token: 'cb-1',
            continuation_url: 'https://example.org/callback?token=cb-1',
          },
        ],
        timelines: [],
        day_labels: [],
        study_days_count: 1,
      }),
    });
  });

  await page.goto(
    'pages/tasks.html?study_name=pw_external&pid=p1&lang=en&completion_status=completed',
    { waitUntil: 'domcontentloaded' }
  );

  const paymentLink = page.locator('#tasks-list .task-item .task-link', {
    hasText: 'Payment Survey',
  });
  await expect(paymentLink).toBeVisible();
  await expect(paymentLink).toHaveAttribute(
    'href',
    'https://example.org/payment?src=playwright&survey_token=tok-1'
  );

  const callbackLink = page.locator('#tasks-list .task-item .task-link', {
    hasText: 'Callback Task',
  });
  await expect(callbackLink).toBeVisible();
  await expect(callbackLink).toHaveAttribute(
    'href',
    'https://example.org/callback?token=cb-1'
  );

  await expect(page.locator('#continue-wrapper')).toBeHidden();
});

test('tasks page confirms callback task and marks it as completed', async ({
  page,
}) => {
  let callbackConfirmed = false;

  await page.route('**/api/studies/pw_callback/study-config**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        study_name: 'Playwright Callback Study',
        study_name_short: 'pw_callback',
        description: 'Mocked callback study config',
        allow_unlisted_participants: false,
        require_consent: false,
        data_collection_start: '2024-01-01T00:00:00Z',
        data_collection_end: '2028-12-31T23:59:59Z',
        default_language: 'en',
        activities_json_url: '/unused.json',
        supported_languages: ['en'],
        selected_language: 'en',
        study_text_end_completed: 'Thanks for finishing the TRAC study.',
        study_text_end_skipped: 'Skipped.',
        study_text_end_noconsent: 'No consent.',
        external_tasks: [
          {
            task_key: 'callback_task',
            name: 'Callback Task',
            description: 'Return here after the provider redirects back.',
            confirmation_type: 'callback',
            assigned_token: 'cb-1',
            continuation_url: 'https://example.org/callback?token=cb-1',
            is_confirmed: callbackConfirmed,
            confirmed_at: callbackConfirmed ? '2026-05-26T10:00:00Z' : null,
          },
        ],
        timelines: [],
        day_labels: [],
        study_days_count: 1,
      }),
    });
  });

  await page.route(
    '**/api/studies/pw_callback/participants/p1/external-tasks/confirm',
    async (route) => {
      callbackConfirmed = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          study_name_short: 'pw_callback',
          participant_id: 'p1',
          task_key: 'callback_task',
          confirmation_type: 'callback',
          is_confirmed: true,
          confirmed_at: '2026-05-26T10:00:00Z',
        }),
      });
    }
  );

  await page.goto(
    'pages/tasks.html?study_name=pw_callback&pid=p1&lang=en&completion_status=completed&callback_task_key=callback_task&callback_token=cb-1',
    { waitUntil: 'domcontentloaded' }
  );

  const callbackTaskRow = page.locator('#tasks-list .task-item', {
    hasText: 'Callback Task',
  });
  await expect(callbackTaskRow).toBeVisible();
  await expect(callbackTaskRow.locator('.task-status')).toContainText(
    'Already completed'
  );

  await expect(
    callbackTaskRow.locator('a.task-link', { hasText: 'Callback Task' })
  ).toHaveCount(0);

  await expect(page.locator('#continue-wrapper')).toBeVisible();
});

test('tasks page redirects noconsent status to thank-you page', async ({
  page,
}) => {
  await page.goto(
    'pages/tasks.html?study_name=pw_noconsent&pid=p1&lang=en&completion_status=noconsent',
    { waitUntil: 'domcontentloaded' }
  );

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  const completionStatus = new URL(page.url()).searchParams.get('completion_status');
  await expect(completionStatus).toBe('noconsent');
});

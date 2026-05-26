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

  await expect(page).toHaveURL(/index\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(
    rawReturnUrl
  );

  await expect(page.locator('#skipReportingBtn')).toBeVisible();
  await page.locator('#skipReportingBtn').click();
  await expect(page.locator('#skipConfirmationModal')).toBeVisible();
  await page.locator('#confirmSkipOk').click();

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

test('thank-you page shows assigned external task link for confirmation_type none', async ({
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
    'pages/thank-you.html?study_name=pw_external&pid=p1&lang=en&completion_status=completed',
    { waitUntil: 'domcontentloaded' }
  );

  const paymentLink = page.locator(
    '#study-custom-message-end a.continue-link',
    { hasText: 'Payment Survey' }
  );
  await expect(paymentLink).toBeVisible();
  await expect(paymentLink).toHaveAttribute(
    'href',
    'https://example.org/payment?src=playwright&survey_token=tok-1'
  );

  await expect(page.locator('#study-custom-message-end')).not.toContainText(
    'Callback Task'
  );
});

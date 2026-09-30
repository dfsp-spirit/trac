const { test, expect } = require('@playwright/test');
const { openSkipConfirmation } = require('./e2e_helpers.js');

function mockDefaultStudyConfig(route, overrides = {}) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      study_name: 'Default Weekly Study for Adults',
      study_name_short: 'default',
      description: 'Mocked default study',
      allow_unlisted_participants: true,
      require_consent: false,
      allow_skip_timeuse: true,
      data_collection_start: '2024-01-01T00:00:00Z',
      data_collection_end: '2028-12-31T23:59:59Z',
      default_language: 'en',
      activities_json_url: '/unused.json',
      supported_languages: ['en'],
      selected_language: 'en',
      study_text_intro: 'Welcome',
      study_text_end_completed: 'Thanks for completing the study.',
      study_text_end_skipped: 'You skipped the diary.',
      study_text_end_noconsent: 'No consent.',
      study_text_consent: null,
      consent_given: null,
      consent_decided_at: null,
      instructions_completed: true,
      instructions_completed_at: '2026-06-10T10:00:00Z',
      participant_has_completed_study: false,
      external_tasks: [],
      all_external_tasks_confirmed: false,
      timelines: [
        {
          name: 'primary',
          display_name: 'Primary',
          description: '',
          mode: 'single-choice',
          min_coverage: 0,
        },
      ],
      day_labels: [
        {
          name: 'monday',
          display_order: 0,
          display_name: 'Monday',
        },
      ],
      study_days_count: 1,
      ...overrides,
    }),
  });
}

function mockDefaultActivitiesConfig(route) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      general: { app_name: 'TRAC' },
      timeline: {
        primary: {
          name: 'Primary',
          mode: 'single-choice',
          min_coverage: 0,
          categories: [
            {
              name: 'Main',
              activities: [{ name: 'Activity 1', code: 101 }],
            },
          ],
        },
      },
    }),
  });
}

test('default study: return_url from invitation is shown on thank-you page for completed flow', async ({
  page,
}) => {
  const rawReturnUrl = 'https://example.org/finish?token=completed123&next=1';
  const encodedReturnUrl = encodeURIComponent(rawReturnUrl);

  await page.route('**/api/studies/default/study-config**', async (route) => {
    await mockDefaultStudyConfig(route, {
      participant_has_completed_study: true,
    });
  });

  await page.goto(
    `index.html?study_name=default&pid=p1&lang=en&return_url=${encodedReturnUrl}`,
    {
      waitUntil: 'domcontentloaded',
    }
  );

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(
    rawReturnUrl
  );

  const continueLink = page.locator('#study-custom-message-end a.continue-link');
  await expect(continueLink).toBeVisible();
  await expect(continueLink).toHaveAttribute('href', rawReturnUrl);
});

test('default study: return_url from invitation is shown on thank-you page after skip flow', async ({
  page,
}) => {
  const rawReturnUrl = 'https://example.org/finish?token=skip456&next=1';
  const encodedReturnUrl = encodeURIComponent(rawReturnUrl);

  await page.route('**/api/studies/default/study-config**', async (route) => {
    await mockDefaultStudyConfig(route, {
      participant_has_completed_study: false,
    });
  });

  await page.route('**/api/studies/default/activities-config**', async (route) => {
    await mockDefaultActivitiesConfig(route);
  });

  await page.goto(
    `index.html?study_name=default&pid=p1&lang=en&return_url=${encodedReturnUrl}`,
    {
      waitUntil: 'domcontentloaded',
    }
  );

  await expect(page).toHaveURL(/index\.html/);

  // The skip action has its own button on desktop and lives in the ⋮ menu on a
  // phone (this spec runs at the default 1280 px viewport, i.e. the phone
  // layout), so go through the shared helper.
  await openSkipConfirmation(page);
  await page.locator('#confirmSkipOk').click();

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(new URL(page.url()).searchParams.get('return_url')).toBe(
    rawReturnUrl
  );

  const continueLink = page.locator('#study-custom-message-end a.continue-link');
  await expect(continueLink).toBeVisible();
  await expect(continueLink).toHaveAttribute('href', rawReturnUrl);
});

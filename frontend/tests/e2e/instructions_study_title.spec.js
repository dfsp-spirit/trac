const { test, expect } = require('@playwright/test');

// The big <h1> on the instructions page can be overridden per study via
// study_text_instructions_title. Without a study value the localized
// instructions.welcomeTitle default must stay in place.
const enLocale = require('../../src/locales/en.json');
const DEFAULT_TITLE = enLocale.instructions.welcomeTitle;

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
      study_text_intro: null,
      study_text_instructions: null,
      study_text_instructions_title: null,
      study_text_end_completed: 'Thanks for completing the study.',
      study_text_end_skipped: 'You skipped the diary.',
      study_text_end_noconsent: 'No consent.',
      study_text_consent: null,
      consent_given: null,
      consent_decided_at: null,
      instructions_completed: false,
      instructions_completed_at: null,
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

async function openInstructions(page, overrides = {}) {
  await page.route('**/api/studies/default/study-config**', (route) =>
    mockDefaultStudyConfig(route, overrides)
  );
  await page.route('**/api/studies/default/activities-config**', (route) =>
    mockDefaultActivitiesConfig(route)
  );
  await page.goto('pages/instructions.html?study_name=default&pid=p1&lang=en', {
    waitUntil: 'domcontentloaded',
  });
  return page.locator('#study-custom-message-title');
}

test('instructions page shows the study-provided title (inline markdown)', async ({
  page,
}) => {
  const title = await openInstructions(page, {
    study_text_instructions_title: 'Welcome to the **MPIAE** time study!',
  });

  await expect(title).toBeVisible();
  await expect(title).toHaveText('Welcome to the MPIAE time study!');
  await expect(title.locator('strong')).toHaveText('MPIAE');
});

test('instructions page keeps the localized default title when the study sets none', async ({
  page,
}) => {
  const title = await openInstructions(page, {});

  await expect(title).toBeVisible();
  await expect(title).toHaveText(DEFAULT_TITLE);
});

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ADMIN_BASE_URL =
  process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://127.0.0.1:3000/tud_backend';
const ADMIN_USER =
  process.env.PLAYWRIGHT_ADMIN_USER || 'timeusediary_api_admin';
const ADMIN_PASS =
  process.env.PLAYWRIGHT_ADMIN_PASS || 'timeusediary_api_admin_password';

function loadActivitiesDefaultConfig() {
  const activitiesPath = path.resolve(
    __dirname,
    '../../../backend/activities_default.json'
  );
  return JSON.parse(fs.readFileSync(activitiesPath, 'utf8'));
}

function buildEmbeddedStudiesConfigPayload() {
  const randomSuffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const selectedStudyNameShort = `embedded_e2e_${randomSuffix}`;

  const activitiesEn = loadActivitiesDefaultConfig();

  const baseStudy = {
    name: `Embedded E2E Study ${randomSuffix}`,
    name_short: selectedStudyNameShort,
    description: 'Embedded activities e2e validation study',
    day_labels: [
      {
        name: 'day1',
        display_order: 0,
        display_names: {
          en: 'Day 1',
        },
      },
    ],
    study_participant_ids: [],
    allow_unlisted_participants: true,
    default_language: 'en',
    supported_languages: ['en'],
    activities_json_data: {
      en: activitiesEn,
    },
    require_consent: false,
    allow_skip_timeuse: true,
    is_paused: false,
    require_diary_before_external_tasks: false,
    data_collection_start: '2025-01-01T00:00:00Z',
    data_collection_end: '2030-01-01T00:00:00Z',
  };

  const secondStudy = {
    ...baseStudy,
    name: `Embedded E2E Other Study ${randomSuffix}`,
    name_short: `embedded_e2e_other_${randomSuffix}`,
  };

  return {
    selectedStudyNameShort,
    studiesConfig: {
      studies: [baseStudy, secondStudy],
    },
  };
}

test('admin file validation mode 4 validates and creates selected embedded study', async ({
  page,
}) => {
  test.skip(
    !ADMIN_USER || !ADMIN_PASS,
    'Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS to run admin e2e test.'
  );

  const auth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  await page.context().setExtraHTTPHeaders({
    Authorization: `Basic ${auth}`,
  });

  await page.goto(`${ADMIN_BASE_URL}/admin/file-validation`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('h1')).toContainText('File Validation');

  const mode4Form = page.locator('form.validation-form[data-mode="full_study_embedded"]');
  await expect(mode4Form).toBeVisible();

  const { selectedStudyNameShort, studiesConfig } =
    buildEmbeddedStudiesConfigPayload();

  await mode4Form.locator('input[name="studies_config_file"]').setInputFiles({
    name: 'studies_config_embedded.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(studiesConfig), 'utf8'),
  });

  await mode4Form.getByRole('button', { name: 'Validate embedded full study' }).click();

  await expect(page.locator('#validationResult')).toBeVisible();
  await expect(page.locator('#validationResult')).toContainText('selection_required');

  await mode4Form.locator('select[name="full_study_name_short"]').selectOption(
    selectedStudyNameShort
  );

  await mode4Form.getByRole('button', { name: 'Validate embedded full study' }).click();

  await expect(page.locator('#validationResult')).toContainText('Validation passed');
  await expect(page.locator('#validationResult')).toContainText('full_study_embedded');

  const createButton = mode4Form.locator('#createEmbeddedStudyBtn');
  await expect(createButton).toBeEnabled();

  await createButton.click();

  await expect(page.locator('#validationResult')).toContainText(
    'Study creation succeeded'
  );
  await expect(page.locator('#createEmbeddedStudyStatus')).toContainText(
    `Study '${selectedStudyNameShort}' was created successfully.`
  );
});

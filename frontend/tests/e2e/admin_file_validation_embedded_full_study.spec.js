const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ADMIN_BASE_URL =
  process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://127.0.0.1:3000/tud_backend';
const ADMIN_USER =
  process.env.PLAYWRIGHT_ADMIN_USER || 'timeusediary_api_admin';
const ADMIN_PASS =
  process.env.PLAYWRIGHT_ADMIN_PASS || 'timeusediary_api_admin_password';
// The admin app can be mounted below a path prefix (e.g. /tud_backend).
const ADMIN_ROOT_PATH = new URL(ADMIN_BASE_URL).pathname.replace(/\/$/, '');

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

test('admin study setup validates and creates a selected embedded study', async ({
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
  await expect(page.locator('h1')).toContainText('Study Setup');

  const studyForm = page.locator('#studyForm');
  const { selectedStudyNameShort, studiesConfig } =
    buildEmbeddedStudiesConfigPayload();

  await studyForm.locator('input[name="studies_config_file"]').setInputFiles({
    name: 'studies_config_embedded.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(studiesConfig), 'utf8'),
  });

  // Two studies in one file: the page asks which one, and detects that the
  // activities are embedded (no activities files required).
  await expect(page.locator('#studySelectorField')).toBeVisible();
  await page.selectOption('#fullStudyNameShort', selectedStudyNameShort);
  await expect(page.locator('#packageMode')).toContainText('embedded');

  await page.locator('#validateStudyBtn').click();

  const result = page.locator('#validationResult');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Validation passed');
  await expect(result).toContainText('full_study_embedded');

  // Review panel: what will be created, then an explicit confirmation.
  await expect(page.locator('#reviewPanel')).toBeVisible();
  await expect(page.locator('#reviewTable')).toContainText(selectedStudyNameShort);
  const createButton = page.locator('#createStudyBtn');
  await expect(createButton).toBeDisabled();
  await page.check('#reviewConfirmed');
  await expect(createButton).toBeEnabled();

  await createButton.click();

  const success = page.locator('#successPanel');
  await expect(success).toBeVisible();
  await expect(success).toContainText(`Study '${selectedStudyNameShort}' was created successfully.`);
  await expect(page.locator('#successInvitesLink')).toHaveAttribute(
    'href',
    new RegExp(`/api/admin/studies/${selectedStudyNameShort}/export-invitation-links\\?format=csv$`)
  );

  // Remove the study again so repeated runs do not pile up test studies.
  await page.evaluate(
    async ([rootPath, nameShort]) => {
      await fetch(`${rootPath}/api/admin/studies/${encodeURIComponent(nameShort)}`, {
        method: 'DELETE',
      });
    },
    [ADMIN_ROOT_PATH, selectedStudyNameShort]
  );
});

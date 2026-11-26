import { test, expect } from '@playwright/test';

const ADMIN_BASE_URL =
  process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://127.0.0.1:3000/tud_backend';
const ADMIN_USER =
  process.env.PLAYWRIGHT_ADMIN_USER || 'timeusediary_api_admin';
const ADMIN_PASS =
  process.env.PLAYWRIGHT_ADMIN_PASS || 'timeusediary_api_admin_password';

test('admin login -> participant management -> study participant list', async ({
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

  await page.goto(`${ADMIN_BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toContainText('Admin Overview');

  await page.getByRole('link', { name: 'Participant Management' }).click();
  await expect(page).toHaveURL(/\/admin\/participant-management/);
  await expect(page.locator('h1')).toContainText('Participant Management');

  await page.selectOption('#studySelect', 'default');
  await page.locator('#loadParticipantsBtn').click();

  await expect(page).toHaveURL(/study_name_short=default/);
  await expect(
    page.getByRole('heading', {
      level: 2,
      // Accept both old format "(\d+)" and new format "(showing X of Y)"
      name: /Participants in study default\s*\((?:showing\s+\d+\s+of\s+\d+|\d+)\)/i,
    })
  ).toBeVisible();
});

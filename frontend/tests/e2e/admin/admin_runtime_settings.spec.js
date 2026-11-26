import { test, expect } from '@playwright/test';

const ADMIN_BASE_URL =
  process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://127.0.0.1:3000/tud_backend';
const ADMIN_USER =
  process.env.PLAYWRIGHT_ADMIN_USER || 'timeusediary_api_admin';
const ADMIN_PASS =
  process.env.PLAYWRIGHT_ADMIN_PASS || 'timeusediary_api_admin_password';

function basicAuthHeader() {
  return `Basic ${Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')}`;
}

test.beforeEach(async ({ page }) => {
  test.skip(
    !ADMIN_USER || !ADMIN_PASS,
    'Set PLAYWRIGHT_ADMIN_USER and PLAYWRIGHT_ADMIN_PASS to run admin e2e test.'
  );
  await page
    .context()
    .setExtraHTTPHeaders({ Authorization: basicAuthHeader() });
});

test('runtime settings are locked until editing is enabled and persist', async ({
  page,
}) => {
  await page.goto(`${ADMIN_BASE_URL}/admin/study/default`, {
    waitUntil: 'domcontentloaded',
  });

  const recent = page.locator('[id^="runtime-recent-"]');
  const save = page.locator('[id^="runtime-settings-save-"]');
  await expect(recent).toBeDisabled();
  await expect(save).toBeDisabled();

  await page.locator('#edit-section-toggle-btn').click();
  await expect(recent).toBeEnabled();
  await expect(save).toBeEnabled();
  await expect(page.locator('[id^="runtime-require-consent-"]')).toBeEnabled();

  const original = await recent.inputValue();
  const changed = original === '4' ? '3' : '4';

  await recent.fill(changed);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    save.click(),
  ]);
  await expect(page.locator('[id^="runtime-recent-"]')).toHaveValue(changed);

  await page.locator('#edit-section-toggle-btn').click();
  await page.locator('[id^="runtime-recent-"]').fill(original);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('[id^="runtime-settings-save-"]').click(),
  ]);
  await expect(page.locator('[id^="runtime-recent-"]')).toHaveValue(original);
});

test('consent activation is disabled when a supported language has no text', async ({
  page,
}) => {
  await page.goto(`${ADMIN_BASE_URL}/admin/study/newui_16_no_recents`, {
    waitUntil: 'domcontentloaded',
  });

  await page.locator('#edit-section-toggle-btn').click();
  const consent = page.locator('[id^="runtime-require-consent-"]');
  await expect(consent).toBeDisabled();
  await expect(
    page.locator('[id^="runtime-consent-missing-"]')
  ).toContainText('Consent text missing for: de');
  await expect(page.getByRole('link', { name: /Texts page/ })).toHaveAttribute(
    'href',
    /\/admin\/study\/newui_16_no_recents\/texts/
  );
});

test('time grid changes ask for confirmation and persist', async ({ page }) => {
  await page.goto(`${ADMIN_BASE_URL}/admin/study/newui_16_no_recents`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('#edit-section-toggle-btn').click();

  const step = page.locator('[id^="runtime-step-"]');
  const minDuration = page.locator('[id^="runtime-min-duration-"]');
  const save = page.locator('[id^="runtime-settings-save-"]');
  const originalStep = await step.inputValue();
  const originalMin = await minDuration.inputValue();
  const newStep = originalStep === '15' ? '10' : '15';
  const newMin = String(Number(newStep) * 2);

  let dialogMessage = '';
  page.once('dialog', async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await step.selectOption(newStep);
  await minDuration.fill(newMin);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    save.click(),
  ]);

  expect(dialogMessage).toContain('time grid');
  await expect(page.locator('[id^="runtime-step-"]')).toHaveValue(newStep);
  await expect(page.locator('[id^="runtime-min-duration-"]')).toHaveValue(
    newMin
  );

  await page.locator('#edit-section-toggle-btn').click();
  await step.selectOption(originalStep);
  await minDuration.fill(originalMin);
  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    save.click(),
  ]);
  await expect(page.locator('[id^="runtime-step-"]')).toHaveValue(
    originalStep
  );
  await expect(page.locator('[id^="runtime-min-duration-"]')).toHaveValue(
    originalMin
  );
});

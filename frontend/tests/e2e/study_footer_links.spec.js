const { test, expect } = require('@playwright/test');

test('footer shows study-specific links configured in studies_config', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  // Should redirect to instructions first
  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();

  // Enter the study
  await page.locator('#continueBtn').click();
  await page.waitForURL(/index\.html/, { timeout: 15000 });

  // Wait for study config to be fully initialized (tud:studyConfigReady fired)
  await page.waitForFunction(
    () => window.TUD_STUDY_CONFIG && window.TUD_STUDY_CONFIG.footer_links,
    { timeout: 20000 }
  );

  // Now check that the study-specific footer links are rendered inside #footer
  const footer = page.locator('#footer');
  await expect(footer).toBeVisible();

  const studyInfoLink = footer.locator('a[href="https://example.com/study-info"]');
  await expect(studyInfoLink).toBeVisible();
  await expect(studyInfoLink).toHaveText('Study Information');
  // in_new_tab: true → should open in new tab
  await expect(studyInfoLink).toHaveAttribute('target', '_blank');

  const contactLink = footer.locator('a[href="https://example.com/contact"]');
  await expect(contactLink).toBeVisible();
  await expect(contactLink).toHaveText('Contact');
  // in_new_tab: false → should not open in new tab
  await expect(contactLink).not.toHaveAttribute('target', '_blank');
});

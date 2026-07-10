const { test, expect } = require('@playwright/test');

test('instructions -> start -> skip reporting -> thank-you page', async ({
  page,
}) => {
  await page.goto('index.html?study_name=default&lang=en', {
    waitUntil: 'domcontentloaded',
  });

  await expect(page).toHaveURL(/pages\/instructions\.html/);
  await expect(page.locator('#continueBtn')).toBeVisible();

  await page.locator('#continueBtn').click();

  await page.waitForURL(/index\.html/, { timeout: 15000 });
  const skipReportingBtn = page.locator('#skipReportingBtn');
  await expect(skipReportingBtn).toBeVisible();

  // The skip button can render before its click handler is attached during
  // late UI initialization. Wait until it is truly interactable to avoid
  // flaky "modal stays hidden" failures in CI.
  await expect
    .poll(async () => {
      const result = await page.evaluate(() => {
        const button = document.getElementById('skipReportingBtn');
        const modal = document.getElementById('skipConfirmationModal');
        if (!button || !modal) {
          return false;
        }
        if (button.offsetParent === null) {
          return false;
        }

        // If clicking opens the modal, handler wiring is ready.
        button.click();
        const opened = modal.style.display === 'block';
        if (opened) {
          // Reset so test can execute the user-visible click path below.
          modal.style.display = 'none';
        }
        return opened;
      });
      return result;
    }, {
      message: 'waiting for skip button handler to be attached',
      timeout: 10000,
    })
    .toBe(true);

  await skipReportingBtn.click();
  await expect(page.locator('#skipConfirmationModal')).toBeVisible();
  await page.locator('#confirmSkipOk').click();

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(page.locator('h1[data-i18n="thankYou.heading"]')).toBeVisible();
});

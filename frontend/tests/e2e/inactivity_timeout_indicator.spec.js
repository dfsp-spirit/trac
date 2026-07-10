const { test, expect } = require('@playwright/test');

test.describe('Inactivity timeout indicator', () => {
  test('timeout indicator is visible on diary page for study with timeout configured', async ({
    page,
  }) => {
    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });

    // The "default" study flow: instructions → diary
    await expect(page).toHaveURL(/pages\/instructions\.html/, {
      timeout: 15000,
    });

    // Click continue to enter the diary
    await page.locator('#continueBtn').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/index\.html/, { timeout: 15000 });

    // ---- Assert the inactivity timer is present and visible ----
    const timerContainer = page.locator('#idleTimeoutIndicator');
    await expect(timerContainer).toBeVisible({ timeout: 10000 });

    // The timer text in calm phase should show "NNm" (e.g., "30m")
    const timerText = page.locator('#idleTimeoutText');
    await expect(timerText).toBeVisible();
    await expect(timerText).toContainText(/^\d+m$/);

    // Verify the calm-phase styling
    await expect(timerText).toHaveClass(/calm/);
  });

  test('timeout indicator is not present for study without timeout configured', async ({
    page,
  }) => {
    // The "15yearolds" study does NOT have inactivity_timeout_minutes configured
    await page.goto('index.html?study_name=15yearolds&lang=en', {
      waitUntil: 'domcontentloaded',
    });

    await expect(page).toHaveURL(/pages\/instructions\.html/, {
      timeout: 15000,
    });

    await page.locator('#continueBtn').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page).toHaveURL(/index\.html/, { timeout: 15000 });

    // Timer should NOT exist when timeout is disabled (0 or unset)
    await expect(
      page.locator('#idleTimeoutIndicator')
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('timeout indicator on mobile viewport displays smaller', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto('index.html?study_name=default&lang=en', {
      waitUntil: 'domcontentloaded',
    });

    await expect(page).toHaveURL(/pages\/instructions\.html/, {
      timeout: 15000,
    });

    await page.locator('#continueBtn').click();
    await page.waitForURL(/index\.html/, { timeout: 15000 });

    const timerContainer = page.locator('#idleTimeoutIndicator');
    await expect(timerContainer).toBeVisible({ timeout: 10000 });

    // On mobile the text font-size should be 11px (set by CSS media query)
    const timerText = page.locator('#idleTimeoutText');
    const fontSize = await timerText.evaluate(
      (el) => window.getComputedStyle(el).fontSize
    );
    expect(fontSize).toBe('11px');

    // Progress bar should be 2px on mobile
    const progressBar = page.locator('#idleTimeoutProgressBar');
    const barHeight = await progressBar.evaluate(
      (el) => window.getComputedStyle(el).height
    );
    expect(barHeight).toBe('2px');
  });
});

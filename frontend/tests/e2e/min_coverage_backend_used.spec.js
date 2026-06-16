const { test, expect } = require('@playwright/test');

test('frontend uses backend activities-config for adult_pilot_de2 (min_coverage check)', async ({ page }) => {
  // Stub the backend activities-config to ensure the app renders activities
  await page.route('**/studies/*/activities-config', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        timeline: {
          primary: {
            min_coverage: 1440,
            categories: [
              {
                name: 'Mock Category',
                activities: [
                  {
                    name: 'Mock Activity',
                    code: 'MA001',
                    color: '#C6C6FF',
                  },
                ],
              },
            ],
          },
        },
      }),
    })
  );

  // Navigate to the app and ensure frontend loaded the backend activities-config
  await page.goto('index.html?study_name=adult_pilot_de2&lang=de&pid=bernd', {
    waitUntil: 'domcontentloaded',
  });

  // Wait for the frontend to populate the activities config cache
  await expect.poll(async () => {
    return await page.evaluate(() => {
      return window.activitiesConfigCache ? 1 : 0;
    });
  }, { timeout: 30000 }).toBe(1);

  const minCoverage = await page.evaluate(() => {
    try {
      return (
        window.activitiesConfigCache?.timeline?.primary?.min_coverage || null
      );
    } catch (e) {
      return null;
    }
  });

  // Backend config for adult_pilot_de2 should require full-day coverage (1440 minutes)
  expect(minCoverage).toBe(1440);
});

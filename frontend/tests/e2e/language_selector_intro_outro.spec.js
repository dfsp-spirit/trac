const { test, expect } = require('@playwright/test');
const { enterConsentAndInstructionsIfNeeded } = require('./e2e_helpers.js');

test('language selector lists supported languages and applies study intro/outro text', async ({
  page,
}) => {
  await page.goto('pages/instructions.html?study_name=9yearolds&lang=sv', {
    waitUntil: 'domcontentloaded',
  });

  await enterConsentAndInstructionsIfNeeded(page).catch(() => undefined);

  await expect(page).toHaveURL(/pages\/instructions\.html/);

  const languageSelect = page.locator('#languageSelect');
  await expect(languageSelect).toBeVisible();
  await expect(languageSelect).toHaveValue('sv');

  const options = await languageSelect.locator('option').allTextContents();
  expect(options).toEqual(expect.arrayContaining(['EN', 'SV']));

  await expect(page.locator('#study-custom-message-intro')).toContainText(
    'Vänligen fyll i denna studie för 9-åringar'
  );

  await page.goto(
    'pages/thank-you.html?study_name=9yearolds&lang=sv&completion_status=skipped',
    {
      waitUntil: 'domcontentloaded',
    }
  );

  await expect(page).toHaveURL(/pages\/thank-you\.html/);
  await expect(page).toHaveURL(/completion_status=skipped/);
  await expect(page.locator('#study-custom-message-end')).toContainText(
    'Du har hoppat över att fylla i tidsanvändningsdelen av studien'
  );
});

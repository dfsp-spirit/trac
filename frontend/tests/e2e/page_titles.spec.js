const { test, expect } = require('@playwright/test');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

// The tab title is the one piece of chrome every participant sees, and it has
// been wrong before: the diary's <title> was wired to the `common.loading` key,
// and because i18n.applyTranslations() rewrites the text of every element with a
// data-i18n attribute (<title> included) it was set back to "Loading..." 2ms
// after script.js had put the study name in. Static reasoning cannot catch an
// ordering bug like that, so this spec asserts the finished state.
//
// Unit-level guards for the underlying wiring live in
// tests/unit/page_titles.test.js.

test.describe('page titles', () => {
  test('the diary tab shows the study name, never the loading message', async ({
    page,
  }) => {
    await page.goto(
      `index.html?pid=title_${Date.now()}&study_name=default&lang=en`,
      { waitUntil: 'load' }
    );
    await enterStudyIfNeeded(page);

    const expectedTitle = await page.evaluate(
      () => window.timelineManager?.general?.app_name
    );
    const loadingText = await page.evaluate(() => window.i18n.t('common.loading'));

    expect(expectedTitle, 'the study config must carry an app_name').toBeTruthy();
    expect(expectedTitle).not.toBe(loadingText);
    // The study's own name, i.e. set after the i18n pass - not the generic
    // fallback this page would show if applyPageTitle() ran too early.
    await expect(page).toHaveTitle(expectedTitle);
    await expect(page).not.toHaveTitle(loadingText);

    // The footer names the same study, and the menu that lives in the same
    // init path does not reset it either.
    await expect(page.locator('#footer_app_title')).toHaveText(expectedTitle);
    await page.locator('#dayPickerBtn').click();
    await expect(page.locator('#dayMenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveTitle(expectedTitle);
  });

  test('the diary tab is localized, not the generic English name', async ({
    page,
  }) => {
    await page.goto(
      `index.html?pid=title_de_${Date.now()}&study_name=default&lang=de`,
      { waitUntil: 'load' }
    );
    await enterStudyIfNeeded(page);

    const expectedTitle = await page.evaluate(
      () => window.timelineManager?.general?.app_name
    );
    const loadingText = await page.evaluate(() => window.i18n.t('common.loading'));
    const genericName = await page.evaluate(() =>
      window.i18n.t('common.pageTitle')
    );

    expect(expectedTitle).toBeTruthy();
    // The German locale really is applied, so this is not an English page.
    expect(genericName).not.toBe('Time Use Diary');
    await expect(page).toHaveTitle(expectedTitle);
    await expect(page).not.toHaveTitle(loadingText);
  });

  test('pre-study pages identify the study, without naming the software', async ({
    page,
  }) => {
    const studyName = 'Default Weekly Study for Adults';
    await page.goto('pages/consent.html?study_name=default&lang=en', {
      waitUntil: 'load',
    });

    // The title is set once the study config has loaded, so poll for it.
    await expect
      .poll(async () => page.title(), {
        timeout: 15000,
        message: 'waiting for the study-name title on the consent page',
      })
      .toBe(`${studyName} - Consent`);
    await expect(page).not.toHaveTitle(/TRAC/);

    await page.goto('pages/open_studies.html', { waitUntil: 'load' });
    await page.locator('#studiesList').waitFor({ state: 'attached' });
    await expect(page).toHaveTitle('Open Studies');
    await expect(page).not.toHaveTitle(/TRAC/);
  });
});

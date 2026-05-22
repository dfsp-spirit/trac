const { expect } = require('@playwright/test');

function isInstructionsUrl(url) {
  return /pages\/instructions\.html/.test(url);
}

function isConsentUrl(url) {
  return /pages\/consent\.html/.test(url);
}

function isIndexUrl(url) {
  return /index\.html/.test(url);
}

async function enterConsentAndInstructionsIfNeeded(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const currentUrl = page.url();

    if (isInstructionsUrl(currentUrl)) {
      return;
    }

    if (isConsentUrl(currentUrl)) {
      const consentAcceptBtn = page.locator('#consentAcceptBtn');
      await consentAcceptBtn
        .click({ timeout: 5000 })
        .then(() => page.waitForLoadState('domcontentloaded'))
        .catch(() => undefined);
      continue;
    }

    await Promise.race([
      page
        .waitForURL((url) => isInstructionsUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
      page
        .waitForURL((url) => isConsentUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
    ]);
  }

  await expect(page).toHaveURL(/pages\/instructions\.html/, {
    timeout: 30000,
  });
}

async function enterStudyIfNeeded(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const currentUrl = page.url();

    if (isIndexUrl(currentUrl)) {
      await page.waitForTimeout(400);
      if (!isIndexUrl(page.url())) {
        continue;
      }

      const dayDisplay = page.locator('#currentDayDisplay');
      const studyUiReady = await dayDisplay
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (studyUiReady && isIndexUrl(page.url())) {
        return;
      }
    }

    if (isConsentUrl(currentUrl)) {
      const consentAcceptBtn = page.locator('#consentAcceptBtn');
      await consentAcceptBtn
        .click({ timeout: 5000 })
        .then(() => page.waitForLoadState('domcontentloaded'))
        .catch(() => undefined);
      continue;
    }

    if (isInstructionsUrl(currentUrl)) {
      const instructionsUrl = new URL(currentUrl);
      instructionsUrl.pathname = instructionsUrl.pathname.replace(
        /\/pages\/instructions\.html$/,
        '/index.html'
      );
      instructionsUrl.searchParams.set('instructions', 'completed');
      await page.goto(instructionsUrl.toString(), {
        waitUntil: 'domcontentloaded',
      });
      continue;
    }

    await Promise.race([
      page
        .waitForURL((url) => isIndexUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
      page
        .waitForURL((url) => isInstructionsUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
      page
        .waitForURL((url) => isConsentUrl(url.toString()), {
          timeout: 5000,
        })
        .catch(() => undefined),
    ]);
  }

  await expect(page).toHaveURL(/index\.html/, {
    timeout: 30000,
  });
}

module.exports = {
  enterConsentAndInstructionsIfNeeded,
  enterStudyIfNeeded,
};

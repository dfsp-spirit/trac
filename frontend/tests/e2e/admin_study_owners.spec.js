const { test, expect } = require('@playwright/test');

/**
 * Study owner management (Roles: scientists + super admins).
 *
 * The owner controls live in the danger zone of the study detail page, inside the
 * locked "Edit Study" section, so they must stay disabled until editing is enabled.
 * Scientists cannot remove themselves; super admins additionally get "Make unowned".
 *
 * The test normalizes the study to "no owners" before and after, so it is safe to
 * run against a development database.
 */

const ADMIN_BASE_URL =
  process.env.PLAYWRIGHT_ADMIN_BASE_URL || 'http://127.0.0.1:3000/tud_backend';
const ADMIN_USER =
  process.env.PLAYWRIGHT_ADMIN_USER || 'timeusediary_api_admin';
const ADMIN_PASS =
  process.env.PLAYWRIGHT_ADMIN_PASS || 'timeusediary_api_admin_password';
const SCIENTIST_USER =
  process.env.PLAYWRIGHT_SCIENTIST_USER || 'test_scientist_alpha';
const SCIENTIST_PASS =
  process.env.PLAYWRIGHT_SCIENTIST_PASS ||
  'test-scientist-alpha-password-do-not-use-in-production';

const STUDY_NAME_SHORT = process.env.PLAYWRIGHT_OWNERS_STUDY || 'default';
const STUDY_URL = `${ADMIN_BASE_URL}/admin/study/${STUDY_NAME_SHORT}`;
const OWNERS_API_URL = `${ADMIN_BASE_URL}/api/admin/studies/${STUDY_NAME_SHORT}/owners`;

function basicAuthHeader(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/** Replace the owner list through the API, using the page's authenticated context. */
async function setOwnersViaApi(page, owners) {
  return page.evaluate(
    async ([url, payload]) => {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return response.status;
    },
    [OWNERS_API_URL, { owner_usernames: owners }]
  );
}

test('admin manages study owners: locked until enabled, add, remove, unowned', async ({
  page,
}) => {
  await page.context().setExtraHTTPHeaders({
    Authorization: basicAuthHeader(ADMIN_USER, ADMIN_PASS),
  });
  await page.goto(STUDY_URL, { waitUntil: 'domcontentloaded' });

  // Normalize: the test study starts and ends without owners.
  expect(await setOwnersViaApi(page, [])).toBe(200);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const chips = page.locator('#studyOwnersChips .owner-chip');
  await expect(chips).toHaveCount(0);
  await expect(page.locator('#studyOwnersChips')).toContainText('No owners');

  // Locked: nothing in the danger zone is interactive until editing is enabled.
  await expect(page.locator('#studyOwnerAddSelect')).toBeDisabled();
  await expect(page.locator('#studyOwnerAddBtn')).toBeDisabled();
  await expect(page.locator('#studyOwnerClearBtn')).toBeDisabled();

  await page.getByRole('button', { name: 'Enable Editing' }).click();
  await expect(page.locator('#studyOwnerAddSelect')).toBeEnabled();
  // Still nothing to clear while the study is unowned.
  await expect(page.locator('#studyOwnerClearBtn')).toBeDisabled();

  // Add an owner: a chip appears and the study meta line is updated live.
  await page.selectOption('#studyOwnerAddSelect', SCIENTIST_USER);
  await page.click('#studyOwnerAddBtn');
  await expect(chips).toHaveCount(1);
  await expect(chips).toContainText(SCIENTIST_USER);
  await expect(page.locator('#studyOwnersStatus')).toContainText(
    'can now fully manage'
  );
  await expect(page.locator('#studyOwnersDisplay')).toContainText(
    SCIENTIST_USER
  );
  // The new owner is no longer offered for adding again.
  await expect(
    page.locator(`#studyOwnerAddSelect option[value="${SCIENTIST_USER}"]`)
  ).toHaveCount(0);
  await expect(page.locator('#studyOwnerClearBtn')).toBeEnabled();

  // Remove the owner again through the chip: access is revoked.
  await chips.locator('.owner-chip-remove').click();
  await expect(chips).toHaveCount(0);
  await expect(page.locator('#studyOwnersChips')).toContainText('No owners');
  await expect(page.locator('#studyOwnersStatus')).toContainText(
    'no longer has access'
  );
  await expect(page.locator('#studyOwnersDisplay')).toContainText(
    'super admins only'
  );
});

test('scientist owner: self-removal locked, no unowned action, can add others', async ({
  browser,
  page,
}) => {
  // Super admin prepares the state: the scientist owns the study.
  await page.context().setExtraHTTPHeaders({
    Authorization: basicAuthHeader(ADMIN_USER, ADMIN_PASS),
  });
  await page.goto(STUDY_URL, { waitUntil: 'domcontentloaded' });
  expect(await setOwnersViaApi(page, [SCIENTIST_USER])).toBe(200);

  const scientistContext = await browser.newContext();
  await scientistContext.setExtraHTTPHeaders({
    Authorization: basicAuthHeader(SCIENTIST_USER, SCIENTIST_PASS),
  });
  const scientistPage = await scientistContext.newPage();

  try {
    await scientistPage.goto(STUDY_URL, { waitUntil: 'domcontentloaded' });

    const scientistChips = scientistPage.locator(
      '#studyOwnersChips .owner-chip'
    );
    await expect(scientistChips).toHaveCount(1);
    await expect(scientistChips).toContainText('(you)');
    await expect(scientistChips).toContainText(SCIENTIST_USER);

    // Super-admin-only action is not rendered for scientists.
    await expect(scientistPage.locator('#studyOwnerClearBtn')).toHaveCount(0);

    // Her own chip cannot be removed, even after unlocking the edit section.
    await expect(
      scientistPage.locator('#studyOwnersChips .owner-chip-remove')
    ).toBeDisabled();
    await scientistPage.getByRole('button', { name: 'Enable Editing' }).click();
    await expect(
      scientistPage.locator('#studyOwnersChips .owner-chip-remove')
    ).toBeDisabled();

    // She can still add other configured scientists as co-owners.
    await expect(scientistPage.locator('#studyOwnerAddSelect')).toBeEnabled();
    expect(
      await scientistPage.locator('#studyOwnerAddSelect option').count()
    ).toBeGreaterThan(1);
  } finally {
    await scientistContext.close();
    // Restore the study to its unowned state.
    expect(await setOwnersViaApi(page, [])).toBe(200);
  }
});

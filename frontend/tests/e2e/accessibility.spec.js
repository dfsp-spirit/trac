const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const { PARTICIPANT_PAGES, MOBILE_VIEWPORT } = require('./participant_pages.js');
const { enterStudyIfNeeded, openParticipantPage } = require('./e2e_helpers.js');

// Automated accessibility check (axe-core) over every participant page and over
// the diary's dialogs.
//
// Nothing else in the suite can see this class of defect: an unreadable grey
// (#ccc footer links were 1.53:1), white text on a light disabled button
// (1.23:1), a zoom-blocking viewport meta, or an aria-label on a bare div. All
// of those shipped and were invisible to the drag/copy/i18n tests because they
// are about how the page computes, not about its behaviour. The same goes for
// the footer backend status and the autosave chip guarded at the end of this
// file: their colours are only wrong in states that come and go, so those specs
// drive the state instead of waiting for it.
//
// Rules run: WCAG 2.0/2.1/2.2 level A + AA.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Render a violation list as a short, readable failure message.
 *
 * @param {Array<{id: string, impact?: string|null, help: string, nodes: Array<{target: string[], html: string, any: Array<{message: string}>}>}>} violations
 * @returns {string}
 */
function formatViolations(violations) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 3)
        .map(
          (node) =>
            `      ${node.target.join(' ')} :: ${node.any[0]?.message || node.html}`
        )
        .join('\n');
      const more =
        violation.nodes.length > 3
          ? `\n      ... and ${violation.nodes.length - 3} more node(s)`
          : '';
      return `    ${violation.id} [${violation.impact}] x${violation.nodes.length}: ${violation.help}\n${nodes}${more}`;
    })
    .join('\n');
}

/**
 * Wait for the page to finish loading its async content and freeze animations,
 * so colour is measured on a settled page (the idle-timer pill pulses).
 *
 * @param {import('@playwright/test').Page} page
 */
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.waitForTimeout(400);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function expectNoA11yViolations(page, label) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    formatViolations(results.violations),
    `accessibility violations on ${label}`
  ).toEqual('');
}

for (const target of PARTICIPANT_PAGES) {
  test(`no accessibility violations: ${target.name}`, async ({ page }) => {
    await openParticipantPage(page, target);
    await settle(page);

    await expectNoA11yViolations(page, target.name);
  });
}

/**
 * Place one activity on the active timeline and return its block.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').Locator>}
 */
async function placeOneActivity(page) {
  const activityButton = page
    .locator(
      '#activitiesContainer .activity-button:visible:not(.has-child-items):not(.custom-input)'
    )
    .first();
  await activityButton.waitFor({ state: 'visible', timeout: 30000 });
  await activityButton.click();

  const timeline = page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first();
  await timeline.waitFor({ state: 'visible', timeout: 10000 });
  await timeline.scrollIntoViewIfNeeded();
  const box = await timeline.boundingBox();
  expect(box, 'active timeline must be visible to place an activity').toBeTruthy();
  // The timeline can be taller than the viewport (timeline = one column per
  // hour), so keep the click inside the visible area.
  const clickY = Math.min(box.y + box.height / 2, page.viewportSize().height - 60);
  await page.mouse.click(box.x + box.width * 0.3, clickY);
  await page.waitForTimeout(600);

  const block = page.locator(
    '.timeline-container[data-active="true"] .activity-block'
  );
  await expect(block.first()).toBeVisible({ timeout: 10000 });
  return block.first();
}

// The activity picker is a dialog on phones and a side panel on desktop.
test('no accessibility violations: activity picker dialog (mobile)', async ({
  page,
}) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto('index.html?pid=a11y_picker&study_name=default&lang=en', {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  await settle(page);

  await page.locator('.floating-add-button').click();
  await expect(page.locator('#activitiesModal')).toBeVisible();
  await expect(
    page.locator('#modalActivitiesContainer .activity-button').first()
  ).toBeVisible({ timeout: 30000 });
  await settle(page);

  await expectNoA11yViolations(page, 'activity picker dialog (mobile)');
});

// "Show info" is the only route to the activity info dialog, and its markup is
// injected on demand - a place where a missing label or role is easy to add.
test('no accessibility violations: activity info dialog (desktop)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('index.html?pid=a11y_info&study_name=default&lang=en', {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  await settle(page);

  const block = await placeOneActivity(page);
  await block.click({ button: 'right' });
  await page.locator('#activityContextMenu [data-action="show-info"]').click();
  await expect(page.locator('#activityInfoModal')).toBeVisible();
  await settle(page);

  await expectNoA11yViolations(page, 'activity info dialog (desktop)');
});

// The two guards below cover colours that only exist in states the specs above
// hit by accident, which is exactly how they shipped broken: the footer status
// line is the readable #475569 while it says "Connecting...", and the autosave
// chip is on screen for 2.5s at a time. Both were then measured at 1.53:1
// (#ccc) and 3.58:1 (green on green) in CI, on whichever run happened to scan
// after the state had settled. They drive the states instead of racing them.

test('no accessibility violations: footer backend status (connected)', async ({
  page,
}) => {
  await page.goto('index.html?pid=a11y_footer&study_name=default&lang=en', {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  // script.js only rewrites the placeholder into its final colour once the
  // activities config has arrived; that is the state worth scanning.
  await page
    .locator('#footer_backend_status[data-i18n="footer.backend_status_connected"]')
    .waitFor({ timeout: 30000 });
  await settle(page);

  await expectNoA11yViolations(page, 'footer backend status (connected)');
});

test('no accessibility violations: autosave status chip', async ({ page }) => {
  await page.goto('index.html?pid=a11y_sync&study_name=default&lang=en', {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  await settle(page);

  // renderSyncStatus is the hook ui.js exposes for the autosave engine, so this
  // renders the real chip markup and classes without waiting for an edit to be
  // saved (or for a save to fail).
  for (const state of ['saved', 'error']) {
    await page.evaluate((value) => window.renderSyncStatus(value), state);
    await expect(page.locator('#syncStatus')).toBeVisible();

    await expectNoA11yViolations(page, `autosave status chip (${state})`);
  }
});

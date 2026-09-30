const { test, expect } = require('@playwright/test');
const {
  PARTICIPANT_PAGES,
  MOBILE_VIEWPORT,
} = require('./participant_pages.js');
const { enterStudyIfNeeded, findTimelinePoint } = require('./e2e_helpers.js');

// Phone layout checks. Every other spec runs at a desktop window size (or sets a
// narrow viewport only to reach the mobile *controls*), so a page that pushes
// content off to the right or renders a 13px-high control passes unnoticed - yet
// most participants answer the diary on a phone.
//
// Covered here:
//  - no sideways scrolling: `width: 100%` plus padding inside pages that do not
//    load the shared stylesheet used to run 20-80px past a 390px viewport
//  - primary diary controls are at least 24x24 CSS px (WCAG 2.2 SC 2.5.8)
//  - the diary reacts to real touch events, not only to mouse events
//
// Known, deliberately not asserted here: inline links in the footer/legal rows
// and the two language <select>s are only 16-19px high. They are reachable and
// axe's target-size rule accepts them, but they are small for a thumb.
test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

for (const target of PARTICIPANT_PAGES) {
  test(`no sideways scrolling on a phone: ${target.name}`, async ({ page }) => {
    await page.goto(target.url, { waitUntil: 'load' });
    await page.locator(target.ready).first().waitFor({ state: 'attached' });
    await page.waitForTimeout(300);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement.scrollWidth,
      clientWidth: document.scrollingElement.clientWidth,
    }));

    expect(
      scrollWidth,
      `${target.name} is ${scrollWidth - clientWidth}px wider than the ${clientWidth}px viewport ` +
        '(content is cut off / the page scrolls sideways on a phone)'
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
}

test('the main diary controls are big enough to tap', async ({ page }) => {
  await page.goto('index.html?pid=mobile_targets&study_name=default&lang=en', {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  await page.locator('#saveDayBtn').waitFor({ state: 'visible' });

  const measured = await page.evaluate(() =>
    [
      ['floating add button', '.floating-add-button'],
      ['save day button', '#saveDayBtn'],
      ['more menu button', '#moreMenuBtn'],
    ].map(([label, selector]) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return {
        label,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    })
  );

  for (const control of measured) {
    expect(
      Math.min(control.width, control.height),
      `${control.label} is ${control.width}x${control.height}px - WCAG 2.2 SC 2.5.8 requires at least 24x24`
    ).toBeGreaterThanOrEqual(24);
  }
});

test('the secondary controls move into the ⋮ menu on a phone', async ({
  page,
}) => {
  await page.goto('index.html?pid=mobile_more_menu&study_name=default&lang=en', {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  await expect(page.locator('#moreMenuBtn')).toBeVisible({ timeout: 30000 });

  // On desktop each of these has a button of its own (or, for the language
  // picker, a row); on a phone they are reached through the ⋮ menu instead.
  await expect(page.locator('#clearTimelineBtn')).toBeHidden();
  await expect(page.locator('#skipReportingBtn')).toBeHidden();
  await expect(page.locator('.language-select-wrapper')).toBeHidden();

  // Moving the skip action off the page also reclaims the footer row it used to
  // occupy - the whole point of hiding its button.
  await expect(page.locator('#instructionsFooter')).toBeHidden();

  const trigger = page.locator('#moreMenuBtn');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  const menu = page.locator('#moreMenu');
  await expect(menu).toBeVisible();

  // Skip time reporting is the only proxied control left in this menu: Clear
  // timeline moved to the timeline menu, and deleting an activity is offered by
  // the long-press menu plus its undo toast.
  await expect(menu.locator('[data-control-id="skipReportingBtn"]')).toBeEnabled();

  // The language picker moved in too, with the active language marked.
  await expect(menu.locator('.more-menu-languages [aria-pressed="true"]')).toHaveText(
    'EN'
  );

  // An item proxies the real handler: "Skip time reporting" opens its dialog.
  await menu.locator('[data-control-id="skipReportingBtn"]').click();
  await expect(page.locator('#skipConfirmationModal')).toBeVisible();
  await expect(menu).toHaveCount(0);
});

test('the day-one banner explains the layout the participant is in', async ({
  page,
}) => {
  const pid = `banner_${Date.now()}`;
  await page.goto(`index.html?pid=${pid}&study_name=default&lang=en`, {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);

  // Phone: the picker is the + button and the finger taps, so the banner must
  // not send anyone looking for an activity list that is not on screen.
  const mobileText = page.locator('.banner-text-mobile');
  await expect(mobileText).toBeVisible({ timeout: 20000 });
  await expect(mobileText).toContainText('tap the + button');
  await expect(page.locator('.banner-text-desktop')).toBeHidden();

  // Desktop: the list is inline below and the mouse clicks.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.reload({ waitUntil: 'load' });

  const desktopText = page.locator('.banner-text-desktop');
  await expect(desktopText).toBeVisible({ timeout: 20000 });
  await expect(desktopText).toContainText('select an activity below');
  await expect(page.locator('.banner-text-mobile')).toBeHidden();
});

test('an activity can be placed with touch alone', async ({ page }) => {
  await page.goto('index.html?pid=mobile_touch&study_name=default&lang=en', {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);

  // Tap the floating add button: this is the mobile-only entry point.
  await page.locator('.floating-add-button').tap();
  await expect(page.locator('#activitiesModal')).toBeVisible();

  const activityButton = page
    .locator(
      '#modalActivitiesContainer .activity-button:not(.has-child-items):not(.custom-input)'
    )
    .first();
  await activityButton.waitFor({ state: 'visible', timeout: 30000 });
  await activityButton.tap();

  // Selecting a plain activity closes the picker after a short delay; an activity
  // with a frequency / child-items dialog leaves both open. Get back to a bare
  // diary either way (Escape closes the top-most dialog, see js/ui.js) - the
  // touch interactions under test are the tap that opened the picker, the tap
  // that picked the activity and the tap that places it.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!(await page.locator('#activitiesModal').isVisible())) {
      break;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await expect(page.locator('#activitiesModal')).toBeHidden();

  // Tapping the timeline has to place the activity - a mouse-only placement path
  // would leave the phone user with a selected activity and no way to place it.
  const timeline = page
    .locator('.timeline-container[data-active="true"] .timeline')
    .first();
  await timeline.scrollIntoViewIfNeeded();
  // The mobile timeline is a tall column inside a clipped pane and the footer is
  // painted over the part that overflows the fold, so ask for a point the
  // timeline actually receives instead of assuming the viewport bottom is one.
  const tapPoint = await findTimelinePoint(page);
  await page.touchscreen.tap(tapPoint.x, tapPoint.y);

  await expect(
    page.locator('.timeline-container[data-active="true"] .activity-block').first()
  ).toBeVisible({ timeout: 10000 });
});

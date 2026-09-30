const { test, expect } = require('@playwright/test');
const { MOBILE_VIEWPORT } = require('./participant_pages.js');
const { enterStudyIfNeeded, placeActivityMobile } = require('./e2e_helpers.js');

// Mobile gesture contract for activity blocks.
//
// A long press is the mobile equivalent of the desktop right-click: it opens the
// activity context menu (Copy / Show info / Delete) and does nothing else. It
// used to delete the activity outright after a 1200 ms hold - no confirmation, no
// menu - and its document-level pointer handler was not gated on the mobile
// breakpoint, so a motionless mouse press armed it on desktop as well.
//
// The same surface used to host a swipe: a left swipe clicked `#nextBtn` (now
// `#saveDayBtn`), which has been "Save Day" since Copy Days, so an accidental
// horizontal drag saved the
// day and triggered a 1.5 s `location.reload()`. That gesture is gone, and the
// test below pins down that a horizontal drag stays inert - it must not save, and
// it must not navigate away from unsaved work.
test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

const ADD_BUTTON = '.floating-add-button';
const CONTEXT_MENU = '#activityContextMenu';

async function openDiary(page, pid) {
  await page.goto(`index.html?pid=${pid}&study_name=default&lang=en`, {
    waitUntil: 'load',
  });
  await enterStudyIfNeeded(page);
  await expect(page.locator(ADD_BUTTON)).toBeVisible({ timeout: 30000 });

  // The floating button is created early; placing an activity also needs the
  // timeline to be the active one, otherwise the click handler bails out.
  await expect
    .poll(async () => page.evaluate(() => !!window.timelineManager?.activeTimeline), {
      timeout: 30000,
      message: 'waiting for the timeline to initialize',
    })
    .toBe(true);
}

/**
 * Press and hold the centre of `locator` for `holdMs`.
 *
 * `hover()` scrolls the block into view and waits until it actually receives
 * pointer events - the timeline re-lays out after the picker closes, so
 * coordinates measured earlier miss the block.
 */
async function pressAndHold(page, locator, holdMs) {
  await locator.hover();
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

test('a long press opens the activity menu instead of deleting', async ({
  page,
}) => {
  await openDiary(page, `e2e-longpress-${Date.now()}`);
  const block = await placeActivityMobile(page);

  // A plain tap on an activity must stay inert.
  await pressAndHold(page, block, 150);
  await expect(page.locator(CONTEXT_MENU)).toBeHidden();
  await expect(block).toHaveCount(1);

  await pressAndHold(page, block, 700);

  const menu = page.locator(CONTEXT_MENU);
  await expect(menu).toBeVisible();
  await expect(menu.locator('.activity-context-menu-item')).toHaveText([
    'Copy',
    'Show info',
    'Delete',
  ]);

  // Opening the menu must not have deleted anything by itself.
  await expect(block).toHaveCount(1);
});

test('deleting through the long-press menu offers a working undo', async ({
  page,
}) => {
  await openDiary(page, `e2e-longpress-delete-${Date.now()}`);
  const block = await placeActivityMobile(page);

  await pressAndHold(page, block, 700);
  await page.locator(`${CONTEXT_MENU} [data-action="delete"]`).click();

  await expect(page.locator('.activity-block')).toHaveCount(0);
  await expect(page.locator(CONTEXT_MENU)).toBeHidden();

  const countActivities = () =>
    page.evaluate(() => {
      const key =
        window.timelineManager.keys[window.timelineManager.currentIndex];
      return (window.timelineManager.activities[key] || []).length;
    });

  expect(
    await countActivities(),
    'the deleted activity must leave the timeline state'
  ).toBe(0);

  // Deleting is one tap in a menu, so the way back is the toast - there is no
  // "remove last" button on any platform any more.
  const toast = page.locator('.toast');
  await expect(toast).toContainText('Activity removed');
  await toast.locator('.toast-action').click();

  await expect(page.locator('.activity-block')).toHaveCount(1);
  await expect(toast).toHaveCount(0);
  expect(await countActivities(), 'undo must put the activity back').toBe(1);
});

test('a horizontal drag does not save the day or navigate', async ({ page }) => {
  await openDiary(page, `e2e-swipe-${Date.now()}`);
  await placeActivityMobile(page);

  const saves = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/activities(\?|$)/.test(request.url())
    ) {
      saves.push(request.url());
    }
  });

  const urlBefore = page.url();
  await page.evaluate(() => {
    window.__tracSwipeMarker = 'alive';
  });

  await page.evaluate(() => {
    const canvas = document.querySelector('.timeline-canvas');
    const rect = canvas.getBoundingClientRect();
    const clientY = rect.top + rect.height / 2;
    const clientX = {
      start: rect.left + rect.width - 30,
      move: rect.left + rect.width - 100,
      end: rect.left + rect.width - 140,
    };

    // Plain Events with assigned touch lists: the `Touch` constructor is not
    // available in Firefox, and this is only about the coordinates a gesture
    // handler would read.
    const dispatchTouch = (type, x) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const touch = { identifier: 1, clientX: x, clientY };
      event.touches = type === 'touchend' ? [] : [touch];
      event.changedTouches = [touch];
      canvas.dispatchEvent(event);
    };
    dispatchTouch('touchstart', clientX.start);
    dispatchTouch('touchmove', clientX.move);
    dispatchTouch('touchend', clientX.end);

    // Same drag as pointer events, so a swipe implemented on either event family
    // is covered.
    const dispatchPointer = (type, x) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          clientX: x,
          clientY,
        })
      );
    };
    dispatchPointer('pointerdown', clientX.start);
    dispatchPointer('pointermove', clientX.move);
    dispatchPointer('pointerup', clientX.end);
  });

  // Longer than the 1.5 s reload the old swipe handler triggered.
  await page.waitForTimeout(2500);

  expect(saves, 'a horizontal drag must not save the day').toEqual([]);
  expect(page.url()).toBe(urlBefore);
  // The old handler reloaded the page; a surviving marker proves it did not.
  expect(await page.evaluate(() => window.__tracSwipeMarker)).toBe('alive');
});

const { test, expect } = require('@playwright/test');
const { MOBILE_VIEWPORT } = require('./participant_pages.js');
const { enterStudyIfNeeded } = require('./e2e_helpers.js');

// Mobile gesture contract for activity blocks.
//
// A long press is the mobile equivalent of the desktop right-click: it opens the
// activity context menu (Copy / Show info / Delete) and does nothing else. It
// used to delete the activity outright after a 1200 ms hold - no confirmation, no
// menu - and its document-level pointer handler was not gated on the mobile
// breakpoint, so a motionless mouse press armed it on desktop as well.
//
// The same surface used to host a swipe: a left swipe clicked `#nextBtn`, which
// has been "Save Day" since Copy Days, so an accidental horizontal drag saved the
// day and triggered a 1.5 s `location.reload()`. That gesture is gone, and the
// test below pins down that a horizontal drag stays inert - it must not save, and
// it must not navigate away from unsaved work.
test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

const ADD_BUTTON = '.floating-add-button';
const MODAL = '#activitiesModal';
const MODAL_ACTIVITIES = '#modalActivitiesContainer .activity-button';
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
 * Place one activity through the mobile flow: the floating `+` opens the picker
 * modal (the inline `.activities-container` is 0x0 at this width), and the
 * position within the day is a clientY on the vertical timeline.
 *
 * @returns {import('@playwright/test').Locator} the placed block, scrolled into view
 */
async function placeActivity(page, positionPercent = 40) {
  await page.locator(ADD_BUTTON).click();
  await expect(page.locator(MODAL)).toBeVisible();
  await expect
    .poll(async () => page.locator(MODAL_ACTIVITIES).count(), {
      timeout: 30000,
      message: 'waiting for the mobile activity picker',
    })
    .toBeGreaterThan(0);

  await page.evaluate((selector) => {
    const buttons = Array.from(document.querySelectorAll(selector));
    const placeable = buttons.find(
      (button) =>
        !button.classList.contains('has-child-items') &&
        !button.classList.contains('custom-input')
    );
    if (!placeable) {
      throw new Error('no placeable activity in the mobile picker');
    }
    placeable.click();
  }, MODAL_ACTIVITIES);
  await expect(page.locator(MODAL)).toBeHidden();

  const selected = await page.evaluate(() => window.selectedActivity);
  expect(selected, 'picking an activity must select it').toBeTruthy();

  // The timeline is far taller than the viewport in the vertical layout, so the
  // placement events are dispatched on the element instead of being tapped at
  // viewport coordinates, and the position within the day is the clientY.
  await page.evaluate((percent) => {
    const timeline = window.timelineManager.activeTimeline;
    const rect = timeline.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + (rect.height * percent) / 100;
    for (const type of [
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click',
    ]) {
      timeline.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          view: window,
        })
      );
    }
  }, positionPercent);

  const block = page.locator('.activity-block').first();
  await expect(block).toHaveCount(1, { timeout: 5000 });
  return block;
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
  const block = await placeActivity(page);

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

test('deleting through the long-press menu removes the activity', async ({
  page,
}) => {
  await openDiary(page, `e2e-longpress-delete-${Date.now()}`);
  const block = await placeActivity(page);

  await pressAndHold(page, block, 700);
  await page.locator(`${CONTEXT_MENU} [data-action="delete"]`).click();

  await expect(page.locator('.activity-block')).toHaveCount(0);
  await expect(page.locator(CONTEXT_MENU)).toBeHidden();

  const remaining = await page.evaluate(() => {
    const key =
      window.timelineManager.keys[window.timelineManager.currentIndex];
    return (window.timelineManager.activities[key] || []).length;
  });
  expect(remaining, 'the deleted activity must leave the timeline state').toBe(0);
});

test('a horizontal drag does not save the day or navigate', async ({ page }) => {
  await openDiary(page, `e2e-swipe-${Date.now()}`);
  await placeActivity(page);

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

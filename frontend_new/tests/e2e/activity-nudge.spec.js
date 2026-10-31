/**
 * Arrow-key nudging of a block (D31): the keyboard path that replaces dragging.
 *
 * `ArrowUp`/`ArrowDown` move the focused activity by one step, `Shift` changes
 * its end instead, the focus stays on the block after the save, and a nudge that
 * would break a rule (the day is full, or the end would pass midnight on the
 * last day) is refused instead of written.
 */
import { test, expect } from '@playwright/test';
import {
  addActivity,
  addSchlafen,
  clearActivities,
  dayEvents,
  isPhone,
  openDiary,
} from './helpers.js';

test.describe('activity nudging', () => {
  const pid = 'diary_01';

  // Arrow keys are the keyboard path for a fine pointer (D31): on a touch screen
  // the shortcuts are switched off by design, so there is nothing to test there.
  test.beforeEach(({}, testInfo) => {
    test.skip(isPhone(testInfo), 'arrow-key nudging needs a keyboard and a fine pointer');
  });

  test.beforeEach(async ({ request }) => clearActivities(request, pid));
  test.afterEach(async ({ request }) => clearActivities(request, pid));

  test('arrows move, Shift changes the end, and focus stays on the block', async ({ page }) => {
    await openDiary(page, pid);
    await addSchlafen(page, { start: 480, end: 540 });
    await expect(dayEvents(page, 0)).toHaveCount(1);

    const block = page.locator('.t-event__btn').first();
    await block.focus();
    await expect(block).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(dayEvents(page, 0).locator('.t-event__time')).toHaveText(/08:10\s*–\s*09:10/);
    // The save re-renders the timeline; focus must come back to the same block.
    await expect(page.locator('.t-event__btn').first()).toBeFocused();

    await page.keyboard.press('ArrowUp');
    await expect(dayEvents(page, 0).locator('.t-event__time')).toHaveText(/08:00\s*–\s*09:00/);

    // Shift moves the end only, so the block shrinks.
    await page.keyboard.press('Shift+ArrowUp');
    await expect(dayEvents(page, 0).locator('.t-event__time')).toHaveText(/08:00\s*–\s*08:50/);
    await page.keyboard.press('Shift+ArrowDown');
    await expect(dayEvents(page, 0).locator('.t-event__time')).toHaveText(/08:00\s*–\s*09:00/);

    // Persisted, not just drawn: reload and look again.
    await page.reload();
    await expect(page.locator('#days .t-timeline-day')).toHaveCount(7);
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*09:00/);
  });

  test('a fast burst of presses is not lost or reordered', async ({ page }) => {
    await openDiary(page, pid);
    await addSchlafen(page, { start: 480, end: 540 });
    await page.locator('.t-event__btn').first().focus();

    // Three presses without waiting for the save in between: the second read
    // would otherwise see stale data and the writes could land out of order.
    for (let press = 0; press < 3; press += 1) await page.keyboard.press('ArrowDown');
    await expect(page.locator('.t-event__time')).toHaveText(/08:30\s*–\s*09:30/);
  });

  test('arrows do nothing without a focused block', async ({ page }) => {
    await openDiary(page, pid);
    await addSchlafen(page, { start: 480, end: 540 });

    await page.locator('.t-topbar').click();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.t-event__time')).toHaveText(/08:00\s*–\s*09:00/);
  });

  test('a nudge that would break a rule is refused', async ({ page }) => {
    await openDiary(page, pid);
    // Different activities, so they are not duplicates: two of them reach this
    // fixture's overlap limit of 2 (D2).
    for (const code of [1101, 1102]) {
      await addActivity(page, code, { start: 480, end: 540 });
    }
    await expect(dayEvents(page, 0)).toHaveCount(2);

    // 09:00-10:00 is still free; nudging it up would be a third block at 08:00.
    await addActivity(page, 1200, { start: 540, end: 600 });
    await expect(dayEvents(page, 0)).toHaveCount(3);

    await page.locator('.t-event__btn').last().focus();
    await page.keyboard.press('ArrowUp');

    await expect(page.locator('.t-toast')).toBeVisible();
    await expect(page.locator('.t-event__time').last()).toHaveText(/09:00\s*–\s*10:00/);

    // The refused range is still on screen only because nothing was written.
    await page.reload();
    await expect(page.locator('.t-event__time').last()).toHaveText(/09:00\s*–\s*10:00/);
  });
});

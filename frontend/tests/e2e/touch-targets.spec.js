/**
 * Tap targets and fit, on whichever viewport the project runs.
 *
 * The day chips are the one control that has to fit seven items into the width
 * of a phone, so they are the ones that quietly shrink below a comfortable
 * target: seven columns of a 288px phone leave 34px each. That failure is a few
 * pixels wide and invisible in a screenshot, so it is measured here instead.
 *
 * The chip row is reached through the form, which is why this spec picks an
 * activity first - the chips only exist inside the form.
 */
import { test, expect } from '@playwright/test';
import { chooseActivity, openDiary } from './helpers.js';

/** 44px is the WCAG 2.5.5 and Apple HIG minimum; --tap-min (48px) is the goal. */
const MIN_TARGET = 44;

test.describe('phone layout', () => {
  test('day chips stay a comfortable target and stay on screen', async ({ page }) => {
    await openDiary(page, 'diary_02');
    await chooseActivity(page, 1101);

    const chips = page.locator('.t-day-chip');
    await expect(chips).toHaveCount(7);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    for (let index = 0; index < 7; index += 1) {
      const box = await chips.nth(index).boundingBox();
      expect(box, `chip ${index} has no box`).not.toBeNull();
      if (!box || !viewport) continue;

      expect(box.width, `chip ${index} width`).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(box.height, `chip ${index} height`).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(box.x, `chip ${index} starts off screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `chip ${index} overflows the viewport`).toBeLessThanOrEqual(
        viewport.width
      );
    }
  });
});
